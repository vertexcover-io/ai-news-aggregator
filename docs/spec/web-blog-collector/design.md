# Web Blog Collector — Design

## Problem Statement

Build a third collector for the AI Newsletter pipeline that ingests posts from
arbitrary blogs and company research pages (e.g. `https://www.anthropic.com/research`),
sitting alongside the existing `hn` and `reddit` collectors. The collector takes
a list of listing URLs as input and emits `RawItemInsert` rows for the latest
posts on each, without requiring CSS selectors or per-source extraction config
beyond the URL itself.

## Context

- **Existing collectors** (`hn.ts`, `reddit.ts`): both follow
  `collectXxx(deps, config) -> CollectorResult`, dispatched by `job.name` in
  `workers/collection.ts:14-29`. Both bundle multiple sub-sources into one job.
- **Repo write-once policy** (`raw-items.ts`): `upsertItems` on-conflict
  updates **only** `engagement`, `metadata`, `updatedAt`. So `title`,
  `content`, `author`, `publishedAt` are write-once per
  `(sourceType, externalId)`. This shapes the LLM-output validation strategy.
- **MVP sources** (`docs/research/mvp-sources.md`): ~34 sources, mostly company
  blogs and research pages with no unified API. A spike at
  `/tmp/jina-gemini-spike.mjs` validated the chosen approach.

## Requirements

### Functional Requirements

1. Accept a `WebCollectConfig` in the BullMQ job payload containing a list of
   sources `{ name, listingUrl }`, a hard cap `maxItems`, and an optional
   `sinceDays` filter.
2. For each source, fetch the listing page via Jina Reader and use Gemini
   (through Vercel AI SDK) to extract the list of blog post URLs that appear
   on the page (excluding nav, footer, sidebar, related, and pagination links).
3. Apply the `sinceDays` filter (if set) to drop posts older than the cutoff,
   then cap the result at `maxItems`.
4. Skip post URLs that already exist in `raw_items` for `sourceType = 'blog'`,
   so already-collected posts don't re-incur LLM cost.
5. For each new post URL, fetch the full article via Jina Reader, then use
   Gemini to extract `title`, `author`, `publishedAt`.
6. Assemble each post into a `RawItemInsert` matching the shape produced by
   `hn.ts:157-170`, with `sourceType: 'blog'`, `externalId` = canonical post URL,
   `content` = the Jina markdown body (envelope stripped), and zero engagement.
7. Upsert the resulting batch via `createRawItemsRepo(db).upsertItems(items)`.
8. Return a `CollectorResult` with `itemsFetched`, `itemsStored`, `durationMs`,
   and `commentsFetched: 0` (blogs have no comments).
9. Be dispatchable via a new `"web-collect"` case in
   `workers/collection.ts:handleCollectionJob`.

### Non-Functional Requirements

- **Idempotency:** Re-running a job for the same sources must never produce
  duplicate rows. Guaranteed by the `(sourceType, externalId)` unique
  constraint plus the dedup pre-check.
- **Observability:** Structured pino logs via `createLogger("collector:web")`
  at job start/complete and per-source/per-post errors.
- **Cost ceiling:** Target ~$5–$10/month at MVP scale (~30 sources, daily run).
  Achieved via `maxItems` cap, dedup pre-check, and Gemini Flash pricing
  (~$0.30/M input, ~$2.50/M output).
- **Rate-limit safety:** Bounded source-level parallelism (`Promise.all` over
  sources) plus per-source `pLimit(postConcurrency ?? 3)` on detail extractions.
  Retry-with-backoff on 429 (mirroring `hn.ts:83-115`). Total in-flight ≈
  `sources × postConcurrency`, stays under Jina free-tier RPM. The `p-limit(3)`
  choice also keeps per-source worst-case time around ~10s, well under the 30s
  `stalledInterval` on `collectionWorker`.
- **Failure visibility:** No silent skips. Every source-level and post-level
  failure is captured in `WebCollectorResult.failures` and emitted as a
  structured pino warn event tagged `event: "collector_failure"`. If *every*
  source in a job fails, `collectWeb` throws so BullMQ marks the job failed
  and retries.

### Edge Cases and Boundary Conditions

1. **Listing card has no visible date but `sinceDays` is set** → accept the
   post. The detail extraction will still attempt to recover `publishedAt`
   from the post page itself, where it is usually present. Worst case: a
   stale post slips in once and is then deduped on subsequent runs.
2. **Gemini hallucinates URLs that don't exist on the listing page** → validate
   each returned URL is a substring of the listing markdown, drop any that
   aren't.
3. **Listing page Jina fetch fails** → record a source-level `CollectorFailure`
   (no `postUrl`), emit a `collector_failure` log with `stage: "discovery-fetch"`
   for grepping, skip the source, let other sources continue.
4. **Listing LLM extraction fails or returns zero posts** → record a
   source-level `CollectorFailure`, log with `stage: "discovery-llm"` or
   `"discovery-empty"`, skip.
5. **Detail page Jina fetch fails** → record a post-level `CollectorFailure`
   (with `postUrl`), log with `stage: "detail-fetch"`, skip the post, continue
   with other posts in the source.
6. **Detail LLM extraction fails** → record a post-level `CollectorFailure`,
   log with `stage: "detail-llm"`, skip.
7. **Detail page LLM returns empty `title`** → record a post-level
   `CollectorFailure`, log with `stage: "validate"`, skip
   (`title` is `NOT NULL` in `raw_items`).
8. **Every source in the job failed** → throw from `collectWeb` so BullMQ
   marks the whole job failed and applies its retry policy. Partial failures
   (some sources worked, some didn't) are *not* job failures — they appear in
   the `WebCollectorResult.failures` array.
9. **Post URL already in DB** → skip the LLM call entirely. Cost optimization;
   ~80% of URLs on subsequent runs are expected to be already-collected.
10. **`publishedAt` extraction returns an invalid date string** → store `null`.
11. **JS-rendered listings (Anthropic, OpenAI)** → trust Jina's headless browser.
    Validated against `anthropic.com/research` in the spike.
12. **Pagination across listing pages** → out of scope. Only the first page is
    consulted. Documented as a known limit.
13. **Auth-required blogs** → out of scope.
14. **Very long posts (50KB+ markdown)** → pass through unchanged. Gemini Flash
    handles them comfortably.

## Key Insights

1. **Repo on-conflict policy means content is write-once.** If Gemini extracts
   garbage on the first run, that garbage stays. Mitigation: validate via Zod,
   never write a row whose required fields are blank.
2. **Pre-checking the DB for known externalIds is a major cost optimization.**
   ~80% of URLs on subsequent runs are already-collected. Skipping the LLM
   detail call cuts per-day cost by roughly that fraction.
3. **The collector doesn't need an LLM for content** — Jina already produces
   clean markdown. The LLM is only used for the 3 metadata fields
   (`title`, `author`, `publishedAt`) and the discovery step.

## Architectural Challenge

**Concurrency vs rate limits.** Two layers: source-level parallel via
`Promise.all` and per-source post-detail parallel via
`pLimit(postConcurrency ?? 3)`. Total in-flight ≈ `sources × postConcurrency`
at peak, ~30 for 10 sources at the default. Stays under Jina free-tier RPM
with headroom for 429 retries via `fetchWithRetry`. If source count grows
past ~15, revisit with a *global* `p-limit` shared across sources.

## Chosen Approach

Jina Reader + Vercel AI SDK with `@ai-sdk/google` calling Gemini 2.5 Flash.
Rejected alternatives: (a) sitemap.xml + Mozilla Readability — required
per-source path-prefix config and fails on sites without sitemaps;
(b) Firecrawl `/map` + `/scrape` — $16–83/month at MVP scale, free tier
insufficient. Validated via `/tmp/jina-gemini-spike.mjs`.

## High-Level Design

### Components

```
packages/pipeline/src/
├── collectors/
│   └── web.ts                     ← new: collectWeb + helpers
├── types.ts                       ← extend: WebCollectConfig + WebCollectJobData
├── workers/
│   └── collection.ts              ← extend: add 'web-collect' case
└── repositories/
    └── raw-items.ts               ← extend: add findExistingExternalIds
```

### Public types (`pipeline/types.ts`)

```
BlogSource:        { name: string, listingUrl: string }

WebCollectConfig:  { sources: BlogSource[],
                     maxItems: number,
                     sinceDays?: number,
                     postConcurrency?: number }

WebCollectJobData: { config: WebCollectConfig }
```

### Failure-tracking types (local to `@newsletter/pipeline`)

```ts
// packages/pipeline/src/types.ts
export interface CollectorFailure {
  source:   string     // BlogSource.name
  postUrl?: string     // present iff a post failed; absent = source-level
  error:    string     // truncated to MAX_ERROR_LENGTH
}

export interface WebCollectorResult extends CollectorResult {
  failures?: CollectorFailure[]
}

// in collectors/web.ts:
const MAX_ERROR_LENGTH = 200;
```

`@newsletter/shared` is not modified. `WebCollectorResult` is a structural
subtype of `CollectorResult`, so the worker dispatcher returns it through
unchanged.

### Function shape (`collectors/web.ts`)

```
WebCollectorDeps:
  - rawItemsRepo: RawItemsRepo
  - fetchFn?:     typeof fetch                 // for unit-test injection
  - llmModel?:    LanguageModelV1              // for unit-test injection

ProcessSourceResult:
  - items:    RawItemInsert[]
  - failures: CollectorFailure[]
  - sourceFailed: boolean

collectWeb(deps, config) -> WebCollectorResult
  - Promise.all(sources, processSource)
  - if every source has sourceFailed: throw
  - upsertItems(allItems)
  - return { ..., failures: failures.length ? failures : undefined }

processSource(source, config, deps) -> ProcessSourceResult
  1. fetchMarkdown(source.listingUrl)         (catch → source-level failure)
  2. discoverPostUrls via LLM                 (catch → source-level failure)
  3. validate URLs are substrings of markdown
  4. applySinceDays → slice(maxItems) → capped
  5. if capped.length === 0: source-level failure (discovery-empty)
  6. findExistingExternalIds → newPosts  (may be empty; normal success, no failure)
  7. processOnePost via pLimit(postConcurrency ?? 3) + Promise.allSettled
  8. partition settled into items and post-level failures

processOnePost(post, source, deps) -> RawItemInsert  (throws on error)
  - fetchMarkdown(post.url)        → on err: throw with stage "detail-fetch"
  - extractPostFields(...)         → on err: throw with stage "detail-llm"
  - validate (title non-empty)     → on err: throw with stage "validate"
  - return buildRawItem(...)

Helpers:
  - fetchMarkdown(url, fetchFn): r.jina.ai/<url>, strip envelope, return body
  - discoverPostUrls(...):  generateText({ output: Output.object({ schema: DiscoverySchema }) })
  - extractPostFields(...): generateText({ output: Output.object({ schema: DetailSchema }) })
  - buildRawItem(postUrl, body, fields): RawItemInsert with sourceType 'blog',
      externalId = postUrl, content = body, engagement {0,0}, metadata {comments:[]}
  - applySinceDays(posts, sinceDays): JS-only filter
```

### Failure logging convention

```ts
logger.warn(
  { event: "collector_failure", collector: "web", source, stage, postUrl, error },
  "collector failure"
)
```

`stage` values (logs only, never in result type): `"discovery-fetch"`,
`"discovery-llm"`, `"discovery-empty"`, `"detail-fetch"`, `"detail-llm"`,
`"validate"`.

End-of-job summary log mirrors `hn.ts:238`:

```ts
logger.info(
  { itemsFetched, itemsStored, failures: result.failures?.length ?? 0, durationMs },
  "collection completed"
)
```

### Zod schemas

```
DiscoverySchema:
  z.object({
    posts: z.array(z.object({
      url: z.string(),
      title: z.string(),
      published_at: z.string(),     // empty string if not visible
    })),
  })

DetailSchema:
  z.object({
    title: z.string(),
    author: z.string(),             // empty string if not stated
    published_at: z.string(),       // empty string if not stated
  })
```

Both schemas avoid unions and `z.record` so they pass Gemini's
structured-output constraints.

### Repo addition (`repositories/raw-items.ts`)

```
findExistingExternalIds(sourceType: SourceType, externalIds: string[]): Promise<Set<string>>
```

Single SQL query: `SELECT external_id FROM raw_items
WHERE source_type = $1 AND external_id = ANY($2)`. Returned as a `Set` for
O(1) membership checks in the collector.

### Worker dispatch (`workers/collection.ts`)

Add a third case to the existing switch:

```
case "web-collect": {
  const db = getDb();
  const rawItemsRepo = createRawItemsRepo(db);
  return collectWeb({ rawItemsRepo }, job.data.config as WebCollectConfig);
}
```

### Configuration and env

New env vars:
- `GEMINI_API_KEY` — required by `@ai-sdk/google` provider. Add to `.env.example`.
- `JINA_API_KEY` — optional; if set, Jina free-tier rate limits are higher.
  Add to `.env.example`.

New dependencies in `@newsletter/pipeline`:
- `ai` (Vercel AI SDK core)
- `@ai-sdk/google` (Gemini provider)
- `zod` (already present in many TS projects; verify)
- `p-limit` (concurrency limiter for per-source post-detail fan-out)

### Tests

Mirrors the existing convention in `tests/unit/collectors/hn.test.ts` and
`tests/e2e/collectors/hn.e2e.test.ts`. Fixtures inline, no `tests/fixtures/`
directory.

**Unit tests** (`tests/unit/collectors/web.test.ts`): mocked `fetch` and
mocked Vercel AI SDK `LanguageModel` injected via `WebCollectorDeps`. Cover
discovery → filter → dedup → detail, URL-substring anti-hallucination guard,
`applySinceDays` / `maxItems` filtering, `findExistingExternalIds` skip path,
per-stage failure recording, "all sources failed → throw" rule.

**E2E tests** (`tests/e2e/collectors/web.e2e.test.ts`): live Jina + live
Gemini. Gated on `process.env.GEMINI_API_KEY` via `describe.skipIf(...)`.
Reuses existing `tests/e2e/setup/test-db.ts` for clean-DB isolation.

Test sources:
- `anthropic-research` → `https://www.anthropic.com/research`
- `openai-news` → `https://openai.com/news`
- `huggingface-blog` → `https://huggingface.co/blog`

Five e2e tests, each bundling related assertions:

1. **multi-source happy path** — all three sources, `maxItems: 2`. Soft
   assertion: each source contributes ≥1 item OR has a recorded failure.
   Validates `RawItemInsert` shape and source-level parallelism.
2. **pinned historical post** — direct `extractPostFields` call against one
   pinned archived post URL (chosen at implementation time). Deterministic
   LLM-extraction sanity check.
3. **dedup + maxItems + sinceDays** — sequential acts on one source covering
   all three filter rules in one test, including `discovery-empty` failure
   recording.
4. **partial failure surfacing** — one working source + one broken source.
   Asserts `collectWeb` does not throw, working source still produces items,
   broken source appears in `failures` with a meaningful error string.
5. **all sources failed throws** — only the broken source. Asserts
   `collectWeb` throws.

Per-test timeout: `60_000` ms. Pinned post URLs and substrings live in a
single `PINNED_POSTS` const at the top of the file.

**Env loading.** Tests do not read `.env` themselves — no `dotenv.config()`
in any setup file. Source the env in the parent shell before running:

```sh
set -a
source .env
set +a
pnpm test:e2e
```

CI populates secrets through the provider's native mechanism (e.g. GitHub
Actions `env:` block), same contract.

## Open Questions

1. **`stalledInterval` budget.** 30s on `collectionWorker`. With `p-limit(3)`
   bringing per-source worst case to ~10s this should be fine, but worth
   confirming with a real benchmark.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Jina rate-limit during peak in-flight burst | Med (>15 sources) | Med | Retry-with-backoff; tunable `postConcurrency` knob; revisit with global `p-limit` if recurring |
| Gemini hallucinates post URLs | Low | High | Validate URL is substring of listing markdown |
| Gemini misextracts title/author/date | Low | Low | `temperature: 0`; Zod validation; write-once dedup means first run sticks |
| Listing page JS-renders weirdly | Low | Per-source loss (recorded) | `CollectorFailure` (no `postUrl`) in result; pino log carries `stage: "discovery-fetch"` or `"discovery-llm"` |
| Cost overrun | Low | Med ($) | `maxItems` cap, dedup pre-check, daily cadence |
| Listing returns 0 posts | Med | Per-source loss (recorded) | `CollectorFailure` in result; pino log carries `stage: "discovery-empty"` |
| BullMQ job timeout (`stalledInterval=30s`) | Low (with `p-limit(3)`) | Whole job re-runs | Per-source parallel post processing brings worst case to ~10s; idempotency makes re-runs safe |
| Every source fails in one run | Low | Whole job marked failed | `collectWeb` throws when all sources failed; BullMQ retry catches transient outages |
| Gemini API outage | Low | Total job failure | All sources fail → throw → BullMQ retry handles |

## Assumptions

1. **Gemini 2.5 Flash is accurate enough for the 3 metadata fields.** If
   precision becomes a problem, upgrade detail extraction to Pro (~10× cost)
   without changing the architecture.
2. **Blog posts on a listing page are ordered newest-first.** True for
   essentially every blog/CMS in the wild. Invalidated by sites that pin
   "featured" posts at the top — `sinceDays` filter mitigates.
