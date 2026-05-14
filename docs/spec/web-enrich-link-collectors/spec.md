# Spec: Web-Enrich Linked URLs in Reddit / HN / Twitter

**Feature ID:** web-enrich-link-collectors
**Linear:** (to be filed)
**Design:** [./design.md](./design.md)
**Probe:** [./library-probe.md](./library-probe.md)
**Status:** Approved
**Date:** 2026-05-14

## 1. Summary

When the Reddit, HN, and Twitter collectors capture a post that links to an external URL, fetch that URL once (no further recursion), extract its title, meta description, OG tags, and main article text using the existing `fetchAdaptive` service, and attach the result to `raw_items.metadata.enrichedLink`. Enrichment is best-effort, runs inline during collection, and never blocks or fails a collector.

## 2. Functional Requirements (EARS)

### FR-1 — Enrichment service module
**The system shall** expose a new module at `packages/pipeline/src/services/link-enrichment/` whose public API is `enrichRawItems(items: RawItemInsert[], ctx: EnrichmentContext): Promise<RawItemInsert[]>` returning the same items with `metadata.enrichedLink` populated for those that were classifiable as enrichable.

### FR-2 — `EnrichedLinkContent` schema
**The system shall** define `EnrichedLinkContent` in `@newsletter/shared/types` with fields:
`url`, `fetchedAt`, `status` (`"ok"` | `"skipped"` | `"failed"`), `skipReason?`, `failureReason?`, `cacheHit?`, `title?`, `byline?`, `description?`, `imageUrl?`, `domain?`, `contentType?`, `markdown?`, `textLength?`. **The system shall** export it from `@newsletter/shared` and nest it as optional field on `RawItemMetadata.enrichedLink`.

### FR-3 — URL classification
**While** processing each `RawItemInsert`, **the system shall** evaluate `shouldEnrich(item)` returning one of:
- `{ enrich: true }`, OR
- `{ enrich: false, skipReason: <EnrichmentSkipReason> }`.

**The system shall** evaluate skip reasons in order: `no-url` → `invalid-url` → `same-platform` → `non-html-media` → `cache-hit`. The first match wins.

### FR-4 — Self-post detection (Reddit)
**When** a Reddit `RawItemInsert` has `url === sourceUrl` OR the Reddit source response had `is_self === true`, **the system shall** classify it with `skipReason: "self-post"` (subclassed under `no-url` for the union — see FR-2 list).

### FR-5 — Empty URL detection (HN)
**When** an HN `RawItemInsert` has `url === ""` OR `url === sourceUrl`, **the system shall** classify it with `skipReason: "no-url"`.

### FR-6 — Twitter URL extraction
**The system shall** extend the Twitter collector (`twitter/rettiwt.ts` and `twitter/map.ts`) to read `inner.entities.urls[]` from the rettiwt tweet payload and store the first non-platform `expandedUrl` as `RawItemInsert.url`. **The system shall** keep the tweet permalink in `RawItemInsert.sourceUrl` (unchanged from today). **If** no external URL is present after filtering, **the system shall** leave `url` set to the tweet permalink — `shouldEnrich` will then classify it `same-platform`.

### FR-7 — Same-platform skip
**The system shall** classify a URL whose host (case-insensitive) is in `{ reddit.com, redd.it, news.ycombinator.com, x.com, twitter.com, t.co }` (including subdomains) with `skipReason: "same-platform"`.

### FR-8 — Non-HTML media skip
**The system shall** classify a URL with `skipReason: "non-html-media"` when EITHER its path extension matches `{ .pdf, .png, .jpg, .jpeg, .gif, .webp, .mp4, .mov, .webm, .mp3, .zip, .tar, .gz, .dmg, .exe }` OR its host (case-insensitive, including subdomains) is in `{ youtube.com, youtu.be, vimeo.com, imgur.com, i.imgur.com, i.redd.it }`.

### FR-9 — Cross-source URL cache (within a run)
**The system shall** keep a per-`EnrichmentContext` `Map<string, EnrichedLinkContent>` keyed by the canonicalized URL (same canonicalization rules as `processors/dedup.ts`: lowercase host, drop fragment, strip query params matching `^(utm_|fbclid$|gclid$|mc_(cid|eid)$)`).
**When** a URL is already present in the cache, **the system shall** copy the cached `EnrichedLinkContent`, set its `cacheHit: true` on the copy, leave `status: "ok"` (assuming the cache entry is `ok`; if cached entry is `failed`/`skipped`, copy as-is with `cacheHit: true`) and not perform a network fetch.

### FR-10 — Fetching
**When** `shouldEnrich` returns `{ enrich: true }`, **the system shall** call `fetchAdaptive(url, "article", { signal, timeoutMs: 15000 })` and map the result to `EnrichedLinkContent` with `status: "ok"`. **If** the result's `markdown` exceeds 100 000 characters, **the system shall** truncate it to the first 100 000 characters and preserve the original `textLength` in the returned struct.

### FR-11 — Fetch failure
**If** `fetchAdaptive` throws or its AbortSignal aborts, **the system shall** record `status: "failed"` with `failureReason` derived from the error message (`"timeout"` if abort, `"http_<code>"` if `Error.message` contains an HTTP status, else the first 120 chars of the message). **The system shall not** rethrow.

### FR-12 — Per-URL timeout
**The system shall** abort a fetch that exceeds 15 seconds wall time by composing the run-level `AbortSignal` with a per-URL `AbortController` (via `AbortSignal.any` or equivalent).

### FR-13 — Run cancellation
**While** a run is cancellable via `ctx.signal`, **the system shall** propagate that signal to every in-flight fetch; **when** the run is cancelled, **the system shall** mark any not-yet-completed enrichment as `status: "failed"`, `failureReason: "cancelled"`, and return immediately without throwing.

### FR-14 — Best-effort isolation
**If** any single enrichment throws unexpectedly (defensive only — `fetchAdaptive` should not throw past its own catches), **the system shall** wrap it in a try/catch, mark the item `failed`, and continue with the next item. **The system shall not** let one URL's failure stop the rest.

### FR-15 — Reddit collector wiring
**The system shall** call `enrichRawItems(items, ctx)` from `collectReddit` after item construction and before `repo.upsertItems`. The `EnrichmentContext` shall include the run logger and the run's `AbortSignal`.

### FR-16 — HN collector wiring
**The system shall** call `enrichRawItems(items, ctx)` from `collectHn` in the same position as Reddit. **The system shall** remove the existing `fetchOgImage` loop. **The system shall** populate `RawItemInsert.imageUrl` from `enrichedLink.imageUrl` when the row's `imageUrl` is `null`/empty AND enrichment status is `"ok"`.

### FR-17 — Twitter collector wiring
**The system shall** call `enrichRawItems(items, ctx)` from the Twitter `collect` function (after `twitter/map.ts` produces the items, before `upsertItems`). **The system shall** populate `RawItemInsert.imageUrl` from `enrichedLink.imageUrl` only when the row has no `photoUrls`-derived image AND enrichment status is `"ok"`.

### FR-18 — Cache sharing across collectors in one run
**The system shall** create one `EnrichmentContext` per run (in the dispatching worker that schedules `Promise.allSettled` over collectors) and pass it to every collector so they share the same URL cache.

### FR-19 — Telemetry
**The system shall** extend `RunSourceTelemetry` with an optional `enrichment` block containing `attempted`, `ok`, `failed`, `skipped`, `skippedReasons` (record keyed by `EnrichmentSkipReason`), `cacheHits`, `avgFetchMs`. **The system shall** update the counters as items are processed and include them in the source telemetry already aggregated per collector.

### FR-20 — Logging
**The system shall** emit a single structured log event `enrichment.fetched` per URL with `{ url, domain, status, durationMs, contentType, textLength?, skipReason?, failureReason? }`. **The system shall** log at `debug` level for `skipped`, `info` for `ok`, `warn` for `failed`.

### FR-21 — No schema migration
**The system shall not** add a new column to `raw_items`. All new data lives in `metadata.enrichedLink` (existing jsonb column).

## 3. Non-Functional Requirements

- **NFR-1:** A run with ~50 items shall not add more than 90 s of wall time on the median (assumes `WEB_CRAWLER_CONCURRENCY` ≥ 4 and avg fetch ≤ 7 s).
- **NFR-2:** No `any` type in new code; explicit return types on exported functions.
- **NFR-3:** All new modules use `@pipeline/*` path aliases, never relative cross-directory imports.
- **NFR-4:** Concurrency is bound by the existing `WEB_CRAWLER_CONCURRENCY` semaphore inside `fetchAdaptive`. No new pool.
- **NFR-5:** Per-item enrichment payload (markdown after truncation) ≤ 100 KB.

## 4. Out of Scope

- Persistent (cross-run) URL cache table.
- PDF / image / video transcript extraction.
- Recursive crawling (depth > 1).
- Updating the ranker / recap prompts to read `metadata.enrichedLink.markdown` — separate PR.
- Re-enriching pre-existing `raw_items` rows.
- Domain allow/deny lists surfaced through `user_settings`.

## 5. Verification Scenarios

These are the live scenarios `functional-verify` will exercise.

### VS-0 (from probe)
N/A — probe was inspection-only.

### VS-1 — Reddit link post and self-post
**Given** a fake Reddit collector input with two items: one with `url = "https://example.com/article"`, one self-post where `url === sourceUrl`,
**When** `enrichRawItems` runs,
**Then** the link-post item has `metadata.enrichedLink.status === "ok"` AND the self-post item has `status === "skipped"`, `skipReason === "no-url"`.

### VS-2 — HN Ask HN and regular submission
**Given** two HN items: an Ask HN with empty `url` and a regular submission linking to `arxiv.org/abs/...`,
**When** `enrichRawItems` runs,
**Then** Ask HN has `skipReason === "no-url"`; the arxiv item has `status === "ok"` AND `metadata.enrichedLink.title` is non-empty.
**And** if the arxiv item originally had `imageUrl === null` and enrichment returned a non-null `imageUrl`, the row's `imageUrl` is populated from it.

### VS-3 — Twitter tweet with arxiv link, tweet with no link
**Given** a tweet payload whose `inner.entities.urls[0].expandedUrl = "https://arxiv.org/abs/2401.00001"` and a second tweet with `entities.urls = []`,
**When** the Twitter collector runs,
**Then** the first item's `RawItemInsert.url` is the arxiv URL (not the tweet permalink) AND `metadata.enrichedLink.status === "ok"`.
**And** the second item's `url` is the tweet permalink AND `metadata.enrichedLink.skipReason === "same-platform"`.

### VS-4 — Cross-source dedup
**Given** a Reddit item and an HN item both with `url = "https://example.com/article"`, processed by separate collectors sharing the same `EnrichmentContext`,
**When** both collectors run,
**Then** the underlying `fetchAdaptive` is invoked exactly once (assert via mock spy); both items' `metadata.enrichedLink.status === "ok"` and `markdown`/`title` are equal; the second item's `enrichedLink.cacheHit === true`.

### VS-5 — Non-HTML media skip
**Given** an item with `url = "https://example.com/paper.pdf"` and another with `url = "https://youtube.com/watch?v=abc"`,
**When** `enrichRawItems` runs,
**Then** both items have `status === "skipped"`, `skipReason === "non-html-media"`. `fetchAdaptive` is not called.

### VS-6 — Slow URL hits the 15 s timeout
**Given** a mocked `fetchAdaptive` that never resolves until the AbortSignal fires,
**When** `enrichRawItems` runs an item pointing at that URL,
**Then** within ≤ 16 s the item's `metadata.enrichedLink.status === "failed"` AND `failureReason === "timeout"`.
**And** the collector function returns normally.

### VS-7 — Run cancellation mid-enrichment
**Given** an `EnrichmentContext` whose `signal` is aborted shortly after `enrichRawItems` starts (e.g. 50 ms),
**When** items are being enriched,
**Then** `enrichRawItems` resolves within ~1 s; any item whose fetch had not completed has `status: "failed"`, `failureReason: "cancelled"`.
**And** no `UnhandledPromiseRejection` is raised.

### VS-8 — Invalid URL
**Given** items with `url ∈ { "javascript:alert(1)", "mailto:x@y.z", "not-a-url", "ftp://example.com" }`,
**When** `enrichRawItems` runs,
**Then** all four items have `status === "skipped"`, `skipReason === "invalid-url"`. `fetchAdaptive` is not called.

### VS-9 — Telemetry counters
**Given** a run with 1 ok, 2 skipped (1 self-post, 1 non-html-media), 1 failed, 1 cache-hit,
**When** the collector returns,
**Then** the per-collector `RunSourceTelemetry.enrichment` matches `{ attempted: 5, ok: 2 (1 fresh + 1 cache hit), failed: 1, skipped: 2, skippedReasons: { "no-url": 1, "non-html-media": 1 }, cacheHits: 1 }`. (Note: `ok` counts both fresh and cache-hit because both produced usable content.)

### VS-10 — No schema migration
**Given** the feature branch,
**When** `pnpm --filter @newsletter/shared db:generate` is run,
**Then** no new migration file is created.

### VS-11 — Markdown size cap
**Given** a mock `fetchAdaptive` returning `markdown` of 250 000 chars and `textLength: 250000`,
**When** `enrichRawItems` runs,
**Then** the stored `metadata.enrichedLink.markdown.length === 100000` AND `metadata.enrichedLink.textLength === 250000`.

## 6. Verification Matrix

| Req | Verified by |
|-----|------------|
| FR-1, FR-2, FR-21 | VS-1, VS-10 |
| FR-3, FR-4, FR-5 | VS-1, VS-2 |
| FR-6 | VS-3 |
| FR-7 | VS-3 |
| FR-8 | VS-5 |
| FR-9, FR-18 | VS-4 |
| FR-10 | VS-2, VS-11 |
| FR-11, FR-12 | VS-6 |
| FR-13, FR-14 | VS-7 |
| FR-15 / 16 / 17 | VS-1 / VS-2 / VS-3 |
| FR-19 | VS-9 |
| FR-20 | covered by unit tests (assert logger calls) |
| invalid URL handling | VS-8 |
