# Run UI — Collect → Dedup → Rank → Show

## Problem Statement

The newsletter pipeline today is a set of BullMQ collectors (`hn`, `reddit`, and
the planned `web` blog collector) that are triggered ad-hoc with no user-facing
surface. To close the feedback loop and make the system actually useful to
Ritesh and Aman, we need a single web page where a user can configure a set of
sources, click submit, and get back a ranked list of the most relevant AI news
items pulled from those sources within a recent time window.

This is the first end-to-end slice of the product: it introduces two brand-new
pipeline stages (deduplication and ranking), the first real API routes, and
the first real frontend page. It explicitly stops short of human review,
digest assembly, and email delivery — those remain deferred.

## Context

### What exists today

- **`@newsletter/shared`**: single Drizzle table `raw_items` keyed by
  `(sourceType, externalId)`, with jsonb `engagement` and `metadata`. No
  `runs`, `sources`, `ranked_items`, or similar tables.
- **`@newsletter/api`**: Hono server exposing only `GET /health`. No routes,
  no services, no auth yet.
- **`@newsletter/pipeline`**:
  - `collectors/hn.ts` — fetches via hnrss.org, keyword/points filters, no
    `sinceDays` field. Config: `HnCollectConfig = { keywords?, pointsThreshold?,
    count?, commentsPerItem?, feeds? }`.
  - `collectors/reddit.ts` — fetches subreddits; has `timeframe?:
    "hour"|"day"|"week"|"month"` (Reddit's `top` window, coarse), not a true
    lookback filter.
  - `workers/collection.ts` — single BullMQ `collection` queue with a switch
    on `job.name` dispatching to `collectHn` / `collectReddit`.
  - `queues/collection.ts` — one `Queue`, nothing else.
- **`@newsletter/web`**: empty React shell (`<h1>AI Newsletter</h1>`).
- **Web blog collector** (`docs/plans/2026-04-07-web-blog-collector-design.md`):
  designed, contract frozen, and a **hard prerequisite for this feature** —
  it must ship before the UI feature can be built end-to-end. Contract:
  - `BlogSource = { name: string; listingUrl: string }`
  - `WebCollectConfig = { sources: BlogSource[]; maxItems: number;
    sinceDays?: number; postConcurrency?: number }`
  - `WebCollectorResult extends CollectorResult` with an optional
    `failures?: CollectorFailure[]` field for per-source / per-post errors.
    `collectWeb` throws only if **every** source fails; otherwise partial
    failures surface via `failures[]`.
  - `sourceType = 'blog'` in `raw_items`, `externalId` = canonical post URL.
  - Uses Jina Reader (`r.jina.ai/<url>`) + Gemini 2.5 Flash via
    `@ai-sdk/google` through the Vercel AI SDK.
  - Requires env vars `GEMINI_API_KEY` (required) and `JINA_API_KEY`
    (optional, raises free-tier rate limits).

### What prompted this

From the April 7 sync (`docs/transcripts/07-04-2026.txt`), Ritesh explicitly
asked for "a UI where I could just potentially enter some sources … click
submit … some processing … show all the news at least … maybe a first sum
could be one version of ranking of those news, and then show those news."
The goal is to reach an end-to-end slice quickly so iteration can happen on
real data, and Ritesh believes it can be "one-shotted" from a strong design.

## Requirements

### Functional requirements

1. **Source configuration form** on a single web page with three source
   groups. The form is ephemeral — no config is persisted between visits.
   - **Websites**: user adds one or more `{ name, listingUrl }` rows (feeding
     directly into `WebCollectConfig.sources`).
   - **Subreddits**: user enters one or more subreddit names plus shared
     `sinceDays` (how far back) and optional `limit` / `sort`.
   - **Hacker News**: user enables HN and sets `sinceDays`, optional
     `keywords` (with implicit OR semantics, matching post titles), and
     optional `pointsThreshold`.
2. **Global run options** on the same form: `topN` (how many ranked items to
   show in results, default 10) and overall `sinceDays` default applied to any
   source that doesn't override it.
3. **Submit endpoint** (`POST /api/runs`): validates the payload, creates a
   new `runId`, initializes run state in Redis, kicks off collection, and
   returns `{ runId }` immediately.
4. **Status endpoint** (`GET /api/runs/:runId`): returns the current run
   state — stage (`pending | collecting | processing | ranking | completed |
   failed`), per-source progress/errors, and (when completed) the ranked list
   of item IDs plus fully hydrated `RankedItem` objects for display.
5. **Collection**: dispatch one BullMQ job per configured source type, all
   running in parallel. Each collector honors `sinceDays`, filters its raw
   output accordingly, and upserts into `raw_items` as it does today.
6. **Deduplication**: after all collection jobs finish, the orchestrator
   builds the candidate set for this run by canonicalizing each item's URL
   (lowercase host, strip trailing slash, drop `utm_*`, `ref`, `source`, and
   similar tracking params, drop fragment) and keeping the first occurrence
   per canonical URL.
7. **Ranking**: a single LLM call (via Vercel AI SDK) receives the deduped
   candidate list (title, url, source, snippet, engagement) and returns a
   ranked list of item IDs plus a one-line rationale per item. Configurable
   model via env var, default to a fast/cheap model (e.g. Gemini Flash or
   Claude Haiku).
8. **Results page**: the frontend polls the status endpoint; when the run
   completes it renders the top `N` items with title, source badge, url,
   published date, engagement, and LLM rationale.
9. **Partial success**: if any single source fails mid-run (rate limit,
   network, scraper error), the run still proceeds with whatever did
   succeed; the failed source is surfaced as a warning in the run status.

### Non-functional requirements

- **Latency target**: end-to-end run time ~1–2 minutes for a typical
  configuration (3–5 websites, 2–3 subreddits, HN enabled). Collectors run
  in parallel; ranking is a single LLM call.
- **Cost containment**: ranking is one batch call per run. Collectors cap
  candidate counts (`maxItems`, Reddit `limit`, HN `count`) so the batch
  stays within a reasonable token budget.
- **Auth**: the page and its API routes sit behind the existing MVP password
  middleware (same class of protection as `/review` and `/admin`).
- **Observability**: structured logs at each stage boundary
  (`run.started`, `run.source.completed`, `run.source.failed`, `run.dedup`,
  `run.rank`, `run.completed`) with `runId`, duration, counts.
- **Idempotency**: collectors remain idempotent (already are — upsert on
  unique `(sourceType, externalId)`). A submit creates a fresh `runId`
  every time; no attempt is made to coalesce duplicate submits.

### Edge cases

- Empty results: all sources return 0 items within `sinceDays`. UI shows
  "no items matched" and the run is marked `completed` with `itemCount=0`.
- Every item dedupes to the same canonical URL (e.g. one source reposts
  everything). Ranked list has one item.
- LLM ranking call fails. First version: run is marked `failed`. Fallback to
  a heuristic ranker (engagement × recency) is deferred — noted as an open
  question.
- Web source configured but all of its sub-sources fail (Jina down, LLM
  quota exceeded, every listing page 404s). `collectWeb` throws, BullMQ
  marks the `web-collect` child failed, and the run's partial-success rule
  surfaces it as a per-source warning without aborting HN/Reddit.
- Web source configured with partial failure — some of its `BlogSource`
  entries succeeded and some failed. `WebCollectorResult.failures[]` is
  non-empty but `collectWeb` did not throw; the orchestrator reads
  `failures.length` and surfaces a condensed warning
  (e.g. `"web: 1 of 3 sources failed"`) while still including the
  successful items in ranking.
- `GEMINI_API_KEY` is missing at submit time. The API rejects the run with
  a 400 if the payload includes any `web` config; if the user submitted
  only HN/Reddit, the run proceeds normally.
- User submits a second run while the first is still in progress. Both runs
  coexist — each has its own `runId` and Redis state. No global lock.
- `sinceDays` is larger than what hnrss or Reddit will return in one page.
  Collectors fetch their maximum page, filter client-side by `publishedAt
  >= now - sinceDays`, and log a warning if the filter dropped nothing (which
  implies we may be missing older-but-in-range items).
- Duplicate submit with identical config in quick succession. Two runs are
  created; this is acceptable and cheap since raw items upsert and ranking
  is one LLM call.
- Redis is restarted mid-run. The BullMQ job state is persisted by BullMQ
  itself (durable), but the Redis-TTL run-state keys are lost. The UI
  polling loop surfaces "run not found" and the user resubmits. Acceptable
  for the MVP.

## Key Insights

1. **The web blog collector design already fixes the website-source contract.**
   We must adopt `BlogSource` / `WebCollectConfig` / `sinceDays` verbatim and
   extend the same convention to HN and Reddit rather than invent a new one.
   This is the single most important consistency decision in the design.

2. **`sinceDays` is not currently supported by any collector.** HN filters by
   keywords/points but not date; Reddit has only the coarse `timeframe` enum.
   Adding `sinceDays` to `HnCollectConfig` and `RedditCollectConfig` and
   enforcing it client-side (filter after fetch) is a prerequisite for this
   feature, not a nice-to-have.

3. **This is a classic fan-out / fan-in workflow.** N parallel collectors,
   barrier, then dedup + rank as one step. BullMQ ships a first-class
   `FlowProducer` for exactly this. Reinventing it with counters in Redis
   would be strictly worse.

4. **"Ephemeral per submit" means no schema change is required on Postgres
   for run state.** Run status, stage, per-source errors, and the ranked list
   of item IDs all fit naturally in Redis keys with a 1-hour TTL. Raw items
   still persist in Postgres via the existing collector upsert path, so the
   API can hydrate the ranked IDs into full items on demand.

5. **Dedup here is for ranking input, not storage.** We are not removing
   rows from `raw_items`. We are picking, for one run's candidate set, one
   representative per canonical URL. This keeps dedup trivially reversible
   and side-effect-free.

6. **The ranking prompt is the quality lever.** Every other piece of this
   design is mechanical. Ranking quality depends almost entirely on the
   prompt and the per-item payload shape. We should treat the prompt as a
   first-class artifact and iterate on it via fixtures.

7. **The web collector is a hard prerequisite, not a stub.** Its design is
   frozen and ready to implement; sequencing it before the UI feature means
   the UI can be tested end-to-end against a real collector from day one
   (which matters given Ritesh's repeated feedback that E2E tests are the
   only way to know the pipeline actually works). The UI feature inherits
   the web collector's `GEMINI_API_KEY` / `JINA_API_KEY` env requirements
   and its `WebCollectorResult.failures[]` richer failure model.

8. **Only the web collector has a structured `failures[]` field** —
   HN and Reddit return plain `CollectorResult`. The orchestrator must
   treat this as an optional field (present iff the child was
   `web-collect`) when building the run state warnings, not as a uniform
   contract across all collectors.

## Architectural Challenges

### 1. Orchestration: fan-out / fan-in

A single submit must trigger N parallel collectors, wait for all to finish
(including failures), then run a single post-processing step. This is
**BullMQ's FlowProducer use case**. Alternatives (manual Redis counters,
a single mega-job that runs collectors with `Promise.all` in-process) either
reimplement the library or lose the benefits of the queue (retries per-child,
concurrency limits, independent observability).

### 2. Run state storage and polling contract

Run state lives in Redis under a key like `run:{runId}` with a serialized
JSON payload and a TTL. Fields:

- `status`: enum
- `stage`: enum (`queued | collecting | processing | ranking | completed |
  failed`)
- `startedAt`, `updatedAt`, `completedAt`
- `sources`: per-source `{ type, status, itemsFetched, errors[] }`
- `rankedItemIds`: number[] (populated on completion)
- `topN`: number
- `warnings`: string[] (e.g. "web collector not implemented — skipped")
- `error`: string (on failure)

The API `GET /api/runs/:runId` reads this key, and if the run is `completed`
it also joins `rankedItemIds` against `raw_items` in Postgres and returns
hydrated `RankedItem` objects. The frontend polls at a modest interval
(2–3s) until the status is terminal.

### 3. Lookback filter semantics, per source

- **Web**: already handled by `applySinceDays` in the planned web collector
  (filters by extracted `publishedAt`).
- **HN**: `HnCollectConfig` gains `sinceDays?: number`. Collector fetches
  its current feed page(s), then filters items by `date_published`. Because
  hnrss returns a fixed-size window, we log a warning if the filter drops
  fewer than some fraction of items (implying we may be truncated early).
- **Reddit**: `RedditCollectConfig` gains `sinceDays?: number`. Collector
  maps the requested window to the closest Reddit `timeframe` bucket
  (`day|week|month`) when `sort === 'top'`, and in all cases filters the
  returned items by `created_utc` client-side.

This is a small change on each collector but it is the single most important
behavioral change needed to support the UI's "last N days" control.

### 4. Web collector integration (not a stub)

The `web-collect` case in `workers/collection.ts` calls the real
`collectWeb` implementation shipped by the web collector feature. The
orchestrator's only web-specific responsibility is reading the optional
`failures[]` field off the returned `WebCollectorResult` and converting
it into a condensed warning on the run state:

- If `failures[]` is absent or empty → no warning.
- If `failures[]` is non-empty → one warning string summarizing count and
  stage distribution (e.g. `"web: 2 of 5 sources failed (discovery-fetch, discovery-llm)"`).
- If the whole `web-collect` child job threw (= every web source failed
  or upstream infra is down) → `sources.web.status = 'failed'` with the
  thrown error message, and the run still completes with whatever HN and
  Reddit produced (per the partial-success rule).

The orchestrator does NOT try to surface per-post failures to the UI —
those live in the pipeline logs (`event: "collector_failure"`) for
debugging. The UI only shows source-level counts and warnings.

### 5. Ranking: prompt, payload shape, output contract

The ranking stage calls the Vercel AI SDK with:

- **System prompt**: defines the selection criteria (AI/ML relevance,
  novelty, practical value for engineers, skip PR/marketing/recap content).
- **User payload**: a compact JSON array, one entry per deduped candidate,
  containing `id`, `title`, `url`, `sourceType`, `publishedAt`, optional
  `snippet`, and normalized `engagement`.
- **Expected output** (via structured generation): `{ ranked: Array<{ id:
  number, score: number, rationale: string }> }`.

The orchestrator then sorts by score, truncates to `topN`, and writes the
ordered IDs plus rationales into the run state.

### 6. Concurrent runs and cost

There is no global lock. Each submit creates an independent flow with its
own `runId`. The assumption is that the password gate is sufficient to keep
concurrent-run count low. A per-user rate limit is out of scope for MVP.

## Approaches Considered

### Approach A — BullMQ FlowProducer (chosen)

A parent `run-process` job with N children (`hn-collect`, `reddit-collect`,
`web-collect`). Children fail-isolate via internal try/catch. Parent job
runs dedup + rank + updates run state.

- **Pros**: idiomatic, library does the barrier and fan-in, each child is
  independently retriable/observable, adding a source type later is one
  more child entry.
- **Cons**: introduces a second BullMQ concept (`FlowProducer` + parent
  jobs) alongside the existing single `Queue` usage; parent jobs
  need their own queue.
- **Effort**: medium. New `process` queue, new `run-process` worker, flow
  producer wiring in the API.

### Approach B — Manual coordination via Redis counter

API enqueues N independent collector jobs with a shared `runId`. Each
collector, on completion, decrements a pending-count key. The last one to
decrement enqueues a `run-process` job.

- **Pros**: reuses the existing single `collection` queue with no new
  BullMQ concepts.
- **Cons**: reimplements FlowProducer poorly, race conditions around the
  decrement-and-trigger step, error handling for "last one failed before
  decrementing" is subtle, no first-class observability of the fan-in.
- **Effort**: medium, but with more ways to be wrong.

### Approach C — Single orchestration job, collectors in-process

API enqueues a single `run` job. That job runs all collectors via
`Promise.all` directly in its own worker, then dedups and ranks.

- **Pros**: simplest code path. One job to reason about.
- **Cons**: loses per-source retry, loses per-source concurrency limits,
  loses the ability to observe collectors independently in the BullMQ UI,
  one giant job timeout governs everything. Also conflicts with the
  existing worker shape (`collection` queue with per-source job names) —
  we'd be going backward.
- **Effort**: smallest implementation effort, highest ongoing cost.

## Chosen Approach

**Approach A — BullMQ FlowProducer**. The feature is fundamentally a
fan-out/fan-in pipeline; using the library's built-in primitive is the
correct default. The only real cost is introducing a second queue
(`processing`) and a parent job type, both of which we'll need anyway once
non-ranking processors (filter, summarize) are added later.

## High-Level Design

### Package-level changes

```
packages/
├── shared/
│   ├── src/types/          ← add RunStatus, RunState, RankedItem, SourceRunState
│   └── src/db/              (no schema change — runs are Redis-only)
├── api/
│   └── src/
│       ├── routes/runs.ts        ← POST /api/runs, GET /api/runs/:runId
│       ├── services/runs.ts      ← createRun, getRun (reads Redis, hydrates from PG)
│       ├── services/rank-hydration.ts ← runId → RankedItem[] via raw_items
│       └── middleware/auth.ts    ← reuse MVP password middleware on /api/runs
├── pipeline/
│   ├── src/types.ts              ← + sinceDays on HnCollectConfig & RedditCollectConfig
│   ├── src/collectors/hn.ts      ← apply sinceDays filter
│   ├── src/collectors/reddit.ts  ← apply sinceDays filter
│   ├── src/collectors/web.ts     ← shipped by web collector feature (prerequisite)
│   ├── src/queues/
│   │   ├── collection.ts         ← unchanged
│   │   └── processing.ts         ← new: "processing" queue for run-process parent jobs
│   ├── src/workers/
│   │   ├── collection.ts         ← + web-collect case (stub)
│   │   └── run-process.ts        ← new: dedup + rank + write ranked IDs into run state
│   ├── src/processors/
│   │   ├── dedup.ts              ← canonicalizeUrl + dedup candidate set
│   │   └── rank.ts               ← Vercel AI SDK call, structured output
│   ├── src/services/run-state.ts ← Redis read/write for run:{id}
│   └── src/services/flow.ts      ← FlowProducer wrapper for enqueueRun
└── web/
    └── src/
        ├── pages/Run.tsx          ← form + submit + polling + results view
        ├── components/SourceForm/ ← Websites, Subreddits, HN blocks
        ├── components/ResultList.tsx
        ├── hooks/useRunPolling.ts
        └── api/runs.ts            ← typed client for POST/GET runs
```

### Data flow

```
User fills form in /run
      │
      ▼ POST /api/runs { config, topN }
      │
API validates payload
      │
API calls runService.createRun:
   - generate runId
   - write initial RunState to Redis (TTL 1h)
   - flowProducer.add:
       parent: { name: "run-process", queueName: "processing",
                 data: { runId, topN } }
       children: [
         { name: "hn-collect",      queueName: "collection", data: { runId, config.hn } },
         { name: "reddit-collect",  queueName: "collection", data: { runId, config.reddit } },
         { name: "web-collect",     queueName: "collection", data: { runId, config.web } },
       ]
      │
      ▼ returns { runId }
      │
Frontend polls GET /api/runs/:runId every ~2s

Collectors run in parallel on the "collection" queue:
   - each respects sinceDays
   - each upserts into raw_items as today
   - each writes its own per-source status back to run:{runId} in Redis
   - internal try/catch → failures become per-source warnings, not thrown

When all children complete, BullMQ triggers the parent run-process job:
   1. Load all raw_items collected for this run window (by sourceType +
      collectedAt >= run.startedAt)
   2. Dedup via canonicalizeUrl
   3. Rank: one Vercel AI SDK call, structured output
   4. Write { stage: "completed", rankedItemIds, completedAt, warnings }
      into run:{runId}

Frontend polling sees status=completed, fetches hydrated ranked items,
renders ResultList.
```

### Run state shape (Redis)

```
run:{runId} = {
  id: string,
  status: "running" | "completed" | "failed",
  stage:  "queued" | "collecting" | "processing" | "ranking"
        | "completed" | "failed",
  startedAt: ISO,
  updatedAt: ISO,
  completedAt: ISO | null,
  topN: number,
  sources: {
    hn?:     { status, itemsFetched, errors[] },
    reddit?: { status, itemsFetched, errors[] },
    web?:    { status, itemsFetched, errors[] },
  },
  rankedItems: Array<{ rawItemId, score, rationale }> | null,
  warnings: string[],
  error: string | null,
}
TTL: 1 hour
```

### Config shape submitted by the UI (ephemeral, not persisted)

```
RunSubmitPayload = {
  topN: number,
  web?: WebCollectConfig,              // { sources: BlogSource[], maxItems, sinceDays }
  reddit?: RedditCollectConfig & { sinceDays: number },
  hn?: HnCollectConfig & { sinceDays: number },
}
```

### UI layout (conceptual)

```
┌────────────────────────────────────────────────────────┐
│ AI Newsletter — New Run                                │
├────────────────────────────────────────────────────────┤
│ Websites                                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ [name] [listingUrl]                        [x]  │  │
│  │ [name] [listingUrl]                        [x]  │  │
│  │ + Add website                                   │  │
│  └──────────────────────────────────────────────────┘  │
│  maxItems per source: [ 5 ]   sinceDays: [ 3 ]         │
│                                                        │
│ Subreddits                                             │
│  [MachineLearning, LocalLLaMA, ...]                    │
│  sort: (hot|new|top)  limit: [25]  sinceDays: [ 3 ]    │
│                                                        │
│ Hacker News                                            │
│  [x] Enabled                                           │
│  keywords: [AI, LLM, GPT, ...]   pointsThreshold: [20] │
│  sinceDays: [ 3 ]                                      │
│                                                        │
│ Top N results: [ 10 ]                                  │
│                                                        │
│                              [ Submit ]                │
└────────────────────────────────────────────────────────┘

            ↓ (after submit)

┌────────────────────────────────────────────────────────┐
│ Run {runId}    stage: collecting    0:42 elapsed       │
│  HN      ✓ 48 items                                    │
│  Reddit  … fetching                                    │
│  Web     ✓ 12 items  (1 of 3 sources failed)           │
└────────────────────────────────────────────────────────┘

            ↓ (when completed)

┌────────────────────────────────────────────────────────┐
│ Top 10 results                                         │
│  1. [HN]   Title …                                     │
│            rationale: concrete new benchmark …         │
│  2. [blog] Title …                                     │
│            rationale: novel architecture paper …       │
│  ...                                                   │
└────────────────────────────────────────────────────────┘
```

## Open Questions

1. **Ranking model and provider.** Vercel AI SDK is decided; which concrete
   model? Gemini Flash, Claude Haiku, and GPT-4o-mini are all candidates.
   Affects cost, latency, and structured-output reliability. Needs to be
   configurable via env.
2. **Ranking prompt — who owns it?** The prompt is the quality lever. Do we
   keep it inline in `processors/rank.ts`, or version it as a file under
   something like `pipeline/prompts/rank.md`? Recommendation: file,
   loaded at startup, so it's diff-friendly and iterable.
3. **Fallback when the ranking LLM call fails.** MVP says "fail the run",
   but a cheap heuristic (engagement × recency) might be worth adding up
   front so the UI never shows a totally empty failed run.
4. **Dedup edge case — same canonical URL, different engagement.** When two
   items collapse to one, which one do we keep? Proposal: keep the one with
   the highest engagement score (points + commentCount).
5. **Concurrent run limits.** Is there any scenario where two people submit
   simultaneously and we want to coalesce? For MVP, no. Worth confirming.
6. **Run history.** We explicitly chose ephemeral + no persistence, but the
   debugging value of being able to look at "what did yesterday's run
   return?" is high. A lightweight `runs` table is one commit away if that
   becomes a pain point.
7. **Auth mechanism for the new page.** The existing rule is "password
   middleware on `/review` and `/admin`." This new page probably belongs in
   the same protected surface — recommend placing it at `/run` behind the
   same middleware.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Ranking quality is poor and the top-N list is not useful | High — undermines the whole feature's value | Medium | Iterate the prompt against real runs; surface rationale in the UI so Aman/Ritesh can spot bad calls; keep the prompt in a versioned file |
| Lookback filter drops items silently because source returned a truncated window | Medium — missing items no one notices | Medium | Log a warning when a filter keeps 100% of fetched items (likely truncation); raise per-source fetch cap where cheap |
| BullMQ FlowProducer behavior differs from our mental model (e.g. parent fires on child failure vs success semantics) | Medium — can cause runs to hang or complete early | Low | Thin integration test for the flow; consult Context7 for current BullMQ flow docs before wiring |
| LLM call exceeds context window with large candidate sets | Medium — ranking fails entirely | Low | Cap deduped candidate count (e.g. 100) before the rank call; drop lowest-engagement items beyond the cap |
| Web collector implementation slips and blocks the UI feature | Medium — UI is dependent on it | Medium | Sequence serially: web collector ships first per its existing SPEC; UI feature picks up after merge. Parallel work only if `pipeline/types.ts` edits are coordinated |
| `GEMINI_API_KEY` / `JINA_API_KEY` missing in the pipeline worker env | Medium — any run with web sources crashes | Medium | API validates presence at submit time when payload includes web config; both keys added to `.env.example` as part of the web collector feature; `/run` form shows a config-missing banner if the API reports them unset |
| Redis TTL expires mid-polling, UI shows "run not found" | Low | Low | 1h TTL is plenty; resubmit on "not found" is acceptable MVP behavior |
| Concurrent runs overload the ranking model quota | Low | Low | Password-gated surface means ≤2 users; revisit if that changes |

## Assumptions

1. Vercel AI SDK is an approved new dependency for this feature
   (`@pipeline` package). Confirmed in today's sync transcript. It is also
   a dependency of the web collector, so the package is already present by
   the time this feature builds on top of it.
2. The web collector ships before this feature starts implementation, per
   its existing design doc (`docs/plans/2026-04-07-web-blog-collector-design.md`)
   and SPEC. Its contract (`WebCollectConfig`, `BlogSource`,
   `WebCollectorResult.failures`, `sourceType: 'blog'`) is the frozen
   interface this feature builds against.
3. `GEMINI_API_KEY` and optionally `JINA_API_KEY` are available in the
   pipeline worker's environment before any run containing web sources is
   submitted. Both are added to `.env.example` as part of the web collector
   feature, not this one.
4. BullMQ FlowProducer is compatible with the Redis instance we already run
   for the `collection` queue.
5. The existing MVP password middleware is acceptable protection for the
   new `/run` page — no per-user auth is required.
6. Ephemeral, non-persisted source config is acceptable for MVP. Users are
   willing to re-enter their source list on each visit, or tolerate that
   the browser's form state is the only memory.
7. Ranking a single batch of ≤100 items fits inside the default context
   window of a fast/cheap model with room for the system prompt and
   structured-output schema.
8. The `raw_items` table is the single source of truth for item details;
   nothing in this feature writes item content anywhere else.
