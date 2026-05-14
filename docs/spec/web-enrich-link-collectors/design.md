# Design: Web-Enrich Linked URLs in Reddit / HN / Twitter

**Date:** 2026-05-14
**Feature:** Inline enrichment of external URLs found in Reddit, HN, Twitter posts
**Spec dir:** `docs/spec/web-enrich-link-collectors/`

## Problem

The Reddit, HN, and Twitter collectors capture the post itself but ignore the article/repo/paper the post is *about*. The ranker and recap LLM end up scoring submissions based only on the post's local context (title, selftext, comments, tweet body) — not the linked content. A tweet that says "wild paper, link in thread" carries no information without fetching the linked URL.

We want each collector to, while it's running, fetch the external URL (one level deep, no recursion), extract title + meta + main article text, and attach it to the raw item so downstream stages have richer context.

## Scope (user-confirmed at brainstorm)

| Decision | Value |
|----------|-------|
| Timing | **Inline during collection** — each collector enriches its own items before returning |
| Extract | **Title + meta + OG tags AND main article text** (Readability) |
| Depth | **1 level** — never follow links found *inside* the fetched page |
| Skip rules | Self-posts/same-platform links; non-HTML media (images, videos, PDFs, archives); already-cached URLs (cross-source dedup within a run) |
| Paywall handling | Not pre-blocked — let `fetchAdaptive` fail gracefully, log, move on |

## Current State (from codebase survey)

- **Reddit** (`packages/pipeline/src/collectors/reddit.ts`): `url` field carries the external URL on link posts; the Reddit permalink for self-posts. `sourceUrl` is always the permalink. Identifying self-posts: `url === sourceUrl` OR Reddit `is_self === true`.
- **HN** (`packages/pipeline/src/collectors/hn.ts`): `url` is nullable; empty string for Ask HN. `sourceUrl` is the HN item page. Already fetches OG image via `fetchOgImage()` — we're widening this to a full enrichment.
- **Twitter** (`packages/pipeline/src/collectors/twitter/*`): tweet entities/URLs are **not currently extracted**. The collector stores the tweet URL itself in `url`. To enrich tweet-linked articles we must first parse `entities.urls[].expandedUrl` from the rettiwt payload (lives at `inner.entities.urls` per Twitter API shape).
- **Web fetcher**: `services/web-fetch/fetchAdaptive(url, mode, opts)` already returns `{ markdown, title, byline, imageUrl, textLength }` using Mozilla Readability + Turndown, with Crawlee/Playwright browser fallback. Concurrency is gated by `WEB_CRAWLER_CONCURRENCY` (default 4).
- **Schema**: `raw_items.metadata` is jsonb (`RawItemMetadata`). Adding an `enrichedLink?: EnrichedLinkContent` field nests cleanly — **no migration required**.
- **Dedup**: in-run URL canonicalization in `processors/dedup.ts` runs *after* collection. We need our own in-process URL cache during collection (cross-collector) to avoid re-fetching the same article when HN and Reddit both link it.

## Design

### 1. New module: `services/link-enrichment`

```
packages/pipeline/src/services/link-enrichment/
  index.ts             // public API: enrichRawItems(items, ctx) -> items
  url-classifier.ts    // shouldEnrich(url, sourceItem) -> { enrich: bool, skipReason?: string }
  cache.ts             // per-run URL fetch cache (in-memory Map keyed by canonicalized URL)
  fetcher.ts           // wraps fetchAdaptive with timeout, size cap, telemetry
  types.ts             // EnrichedLinkContent, EnrichmentResult, EnrichmentSkipReason
  __tests__/           // unit tests for classifier + cache + fetcher (mocked)
```

The collector touch is one line per collector:

```ts
const items = await collectRaw(...);
const enriched = await enrichRawItems(items, { logger, signal, cache });
await repo.upsertItems(enriched);
```

The cache is passed in from the orchestrator (or created per collector if no orchestrator scope) so two collectors running in the same `Promise.allSettled` wave share it.

### 2. `EnrichedLinkContent` shape

Lives in `@newsletter/shared/types`:

```ts
interface EnrichedLinkContent {
  url: string;              // canonicalized URL that was fetched
  fetchedAt: string;        // ISO timestamp
  status: "ok" | "skipped" | "failed";
  skipReason?: EnrichmentSkipReason;
  failureReason?: string;   // short message; full error in logs only
  title?: string;
  byline?: string;
  description?: string;     // og:description / meta description
  imageUrl?: string;        // og:image
  domain?: string;          // host portion, lowercased
  contentType?: "html" | "pdf" | "image" | "video" | "other";
  markdown?: string;        // Readability-extracted main content, capped (see §5)
  textLength?: number;      // length of extracted text in chars
}

type EnrichmentSkipReason =
  | "self-post"               // Reddit is_self, HN no URL, Twitter self-link
  | "same-platform"           // links back to reddit/x.com/news.ycombinator.com
  | "non-html-media"          // youtube, .pdf, .png, .mp4, .zip, ...
  | "cache-hit"               // already enriched earlier in this run
  | "no-url"                  // item had no external URL field at all
  | "invalid-url";            // malformed/non-http(s)
```

Stored at `raw_items.metadata.enrichedLink`. Never replaces or overwrites the source-extracted `title`, `url`, `content`, `imageUrl` on the row — it's purely additive. Downstream consumers (ranker, recap) read from `metadata.enrichedLink` when present.

### 3. URL classification (`shouldEnrich`)

Order of checks (first match wins, short-circuits):

1. **No URL** → skip `no-url`. Reddit: `url === sourceUrl` OR Reddit API `is_self === true`. HN: `url` empty. Twitter: no `entities.urls[]` after filtering.
2. **Invalid URL** → skip `invalid-url`. Parse with WHATWG `URL`; require `http:` or `https:`.
3. **Same-platform** → skip `same-platform`. Host matches an allowlist of platforms we already scrape: `reddit.com`, `redd.it`, `news.ycombinator.com`, `x.com`, `twitter.com`, `t.co`. (No paywall list — explicitly out of scope per user.)
4. **Non-HTML media** → skip `non-html-media`. By extension: `.pdf .png .jpg .jpeg .gif .webp .mp4 .mov .webm .mp3 .zip .tar .gz .dmg .exe`. By host: `youtube.com`, `youtu.be`, `vimeo.com`, `imgur.com`, `i.redd.it`, `i.imgur.com`. (Future: PDF-text extraction is a follow-up; today, skip.)
5. **Cache hit** → skip `cache-hit`. Canonicalize URL (same rules as `dedup.ts`: lowercase host, drop hash, strip `utm_*`/`fbclid`/`gclid`), check the per-run `Map<string, EnrichedLinkContent>`. On hit, copy the cached `EnrichedLinkContent` (same object) into the new item's metadata — both items share the result. This satisfies the user's "already-cached URLs" rule and gives cross-source dedup for free.
6. Otherwise → enrich.

### 4. Fetching (`fetcher.ts`)

Wraps `fetchAdaptive(url, "static-first", opts)` with:
- **Per-URL timeout:** 15 s hard cap. Aborts via `AbortSignal`.
- **Size cap:** if `textLength > 100_000` chars, truncate `markdown` to 100 k chars (keep prefix). Avoids dumping a 2 MB documentation page into the ranker prompt.
- **Result mapping:** `ConvertResult` → `EnrichedLinkContent` with `status: "ok"`.
- **Error mapping:** any throw / non-ok response → `{ status: "failed", failureReason: shortMessage }`. Never throws upward — enrichment is best-effort.
- **Telemetry:** logs `event: "enrichment.fetched"` (ok | failed | skipped) with `{ url, domain, durationMs, contentType, textLength?, skipReason?, failureReason? }`.

Concurrency stays bound by the existing `WEB_CRAWLER_CONCURRENCY` semaphore inside `fetchAdaptive` — we do not introduce a new pool.

### 5. Per-collector wiring

**Reddit** (one call site, after fetching all items, before `upsertItems`):
```ts
const enriched = await enrichRawItems(items, ctx);
```
`shouldEnrich` recognises self-posts because the collector sets `url = sourceUrl` for them.

**HN** (replaces the existing `fetchOgImage` loop, which is a strict subset of the new enrichment):
- Drop `fetchOgImage`.
- On enrichment success, if `item.imageUrl` is empty and `enriched.imageUrl` is set, copy it onto the row (preserves the today behaviour where HN cards get OG images).

**Twitter** (new URL extraction logic in `twitter/rettiwt.ts` / `twitter/map.ts`):
- Parse `inner.entities.urls[]` (each entry has `expandedUrl`); pick the first non-platform URL.
- Store the expanded URL on the `NormalizedTweet` so `map.ts` can place it on the `RawItemInsert`. The post `url` (tweet permalink) stays in `sourceUrl`-equivalent role; the linked article URL goes to `url`.
- If a tweet has >1 external URL, enrich only the first. (Cheaper; rare to have >1 substantive link in our AI-news feeds; revisit if needed.)
- Tweets with no external URL → `url` stays as the tweet permalink; `shouldEnrich` flags `self-post` because `url === sourceUrl`.

### 6. Telemetry

Per-collector telemetry already aggregates into `RunSourceTelemetry`. Extend it:
```ts
interface RunSourceTelemetry {
  // ...existing fields
  enrichment?: {
    attempted: number;
    ok: number;
    failed: number;
    skipped: number;
    skippedReasons: Record<EnrichmentSkipReason, number>;
    cacheHits: number;
    avgFetchMs: number;
  };
}
```

The counters update inside the enrichment service via a per-collector reporter callback. The Slack review-completion message already prints source telemetry — these numbers will show up there too (free).

## Edge Cases & Mitigations

| # | Edge case | Mitigation |
|---|-----------|------------|
| 1 | Reddit self-post (url === permalink) | `shouldEnrich` returns `skip: self-post`. |
| 2 | HN Ask/Show with no URL | `url` empty → `skip: no-url`. |
| 3 | Twitter with no entities.urls | After extraction `url` falls back to tweet permalink; `same-platform` skip. |
| 4 | Tweet has >1 external URL | Enrich first non-platform one; ignore others. |
| 5 | t.co or shortened URLs | rettiwt provides `expandedUrl` already. For Reddit/HN, redirect-following is handled inside `fetchAdaptive` (Node fetch + Crawlee both follow). |
| 6 | Cross-source duplicate (HN + Reddit linking same article) | Per-run URL cache, keyed by canonicalized URL. Both items get the same enrichment, only one network fetch. |
| 7 | Cross-run cache | Out of scope for MVP — adds DB table; today's runs are daily and don't justify it. Flagged as follow-up. |
| 8 | Non-HTML media (PDF, image, video) | `non-html-media` skip by extension + host. Stored as `skipped`, not failed. |
| 9 | Paywalled article | Not pre-blocked. `fetchAdaptive` returns either a paywall snippet (Readability still extracts what's visible — sometimes fine) or fails. Failure path → `status: "failed"`, doesn't block the item. |
| 10 | Page returns 404 / 5xx | `fetchAdaptive` throws → captured → `status: "failed"`, `failureReason: "http_404"` (or similar). |
| 11 | Page is huge (>100 k chars markdown) | Truncate at 100 k chars; record `textLength` of original. |
| 12 | Slow page (server hangs) | 15 s per-URL timeout via AbortSignal. |
| 13 | Concurrent collectors stampede the same domain | `WEB_CRAWLER_CONCURRENCY` already caps; the per-run URL cache deduplicates same-URL calls. |
| 14 | Run cancellation (`run:cancel:{runId}`) | Enrichment loop respects the run's `AbortSignal`. Pending fetches abort, in-flight items mark `status: "failed", failureReason: "cancelled"`. |
| 15 | Malformed URL (`javascript:`, `mailto:`, `ftp://`) | `invalid-url` skip — only `http(s):` proceeds. |
| 16 | Redirect to a same-platform URL | After fetch, if final URL host is same-platform, we still keep the result (the article body matters; the canonicalization is for cache keying). Same-platform check runs on the *original* URL only. |
| 17 | Image-only Twitter post (photoUrls but no entities.urls) | `same-platform` skip after `entities.urls` filter — already covered. |
| 18 | Item has no `url` field at all (defensive) | `no-url` skip. |
| 19 | Enrichment service throws unexpectedly | Per-item try/catch in the service; one bad URL never poisons the whole collector. The collector itself ignores enrichment failures and proceeds with non-enriched items. |
| 20 | Memory pressure from large `markdown` payloads in metadata jsonb | 100 k cap per item × ~50 items/day × jsonb = bounded. Storage cost negligible. |
| 21 | Future PDF extraction | Out of scope; classified as `non-html-media` today. Follow-up ticket. |

## Verification (preview — full version goes in spec.md)

VS-1: Reddit collector with one link post and one self-post → link post's row has `metadata.enrichedLink.status === "ok"`; self-post has `status === "skipped"`, `skipReason === "self-post"`.
VS-2: HN collector with one Ask HN and one regular submission → Ask HN skipped, regular has enriched content; OG image populates `raw_items.imageUrl` if previously empty.
VS-3: Twitter collector with a tweet linking arxiv.org and a tweet with no links → first has enriched content, second skipped `same-platform`.
VS-4: Same URL linked from a Reddit post and an HN post in one run → only one `fetchAdaptive` call (assert via mock), both rows get matching `enrichedLink` content, second row has `skipReason: cache-hit`. *Wait — `skipReason` and `status: ok` are mutually exclusive in §2; refine:* on cache hit, status stays `"ok"` (content was successfully obtained) but a `cacheHit: true` flag is added. **Spec update needed.** Refine in §2: `EnrichedLinkContent.cacheHit?: boolean`.
VS-5: Non-HTML URL (`https://example.com/paper.pdf`) → skipped `non-html-media`.
VS-6: Slow URL (mock: never resolves) → after 15 s, `status: failed`, `failureReason: "timeout"`. Collector proceeds.
VS-7: Cancelled run → in-flight enrichments abort within ~1 s; pending items remain unenriched without throwing.

## External Dependencies & Fallback Chain

**No new external libraries.** Reuses:
- `services/web-fetch/fetchAdaptive` (already in repo) — Readability + Turndown + Crawlee.
- WHATWG `URL` (Node built-in) for parsing.

If `fetchAdaptive` is unavailable or broken for a given URL (probe in stage 1.5 will confirm it works), fallback chain:
1. **Primary:** `fetchAdaptive` static-first.
2. **Fallback:** browser path inside `fetchAdaptive` (already automatic).
3. **Final:** mark item as `status: failed`, log, proceed without enrichment.

There is no "switch to a different library" fallback because the only dep is in-repo. If `fetchAdaptive` is fundamentally broken, that's a separate bug to fix in that service — not solvable by swapping a library here.

## Non-Goals

- Persistent (cross-run) URL cache table — too much infra for daily runs.
- PDF / video transcript extraction — separate feature.
- Recursive crawling (depth > 1) — explicitly forbidden by user.
- Replacing the existing dedup pipeline with URL-content similarity — separate idea, out of scope.
- Re-enriching old `raw_items` — only forward-looking from feature merge.
- Updating the ranker / recap prompts to *use* `metadata.enrichedLink` — that's a follow-up PR; this one just produces the data. (Confirm with user — see Open Questions.)

## Open Questions

1. **Should the ranker/recap consume `metadata.enrichedLink.markdown` in this same PR, or in a follow-up?** Recommend follow-up — keeps this PR small and testable. The data being present and correct is verifiable on its own; using it well is a prompt-engineering exercise that deserves its own iteration.
2. **Domain allowlist/denylist surface?** Today: hardcoded constants in `url-classifier.ts`. If the user wants to tune from `user_settings` later, we add a column then. Not now.

## Risks

- **Slow collectors.** Worst case: ~50 fetches × 15 s timeout / `WEB_CRAWLER_CONCURRENCY=4` ≈ 3 min added to a run. Probably 30–60 s realistic. Mitigation: per-URL timeout + concurrency cap.
- **Quality of `fetchAdaptive` on AI-blog domains.** Substack, Medium, GitHub README, arxiv abstracts are the common targets; Readability handles all of these well in our experience.
- **Telemetry noise.** Many `skipped` events could flood logs. Mitigation: log `skipped` at `debug` level, only `ok` / `failed` at `info`.
