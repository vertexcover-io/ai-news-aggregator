---
governs: packages/pipeline/src/services/link-enrichment/
last_verified_sha: ad0153a
key_files: [index.ts, types.ts, cache.ts, fetcher.ts, url-classifier.ts]
flow_fns: [index.ts::enrichRawItems, fetcher.ts::enrichOne, url-classifier.ts::shouldEnrich]
decisions: [D-080]
status: active
---

# services/link-enrichment/ — inline URL enrichment for collector items

## Purpose
After collectors fetch items from HN, Reddit, and Twitter, external URLs (blog posts, articles, etc.) are enriched in-place: fetch the page, convert to markdown via Readability+Turndown, and attach `EnrichedLinkContent` to `RawItemInsert.metadata.enrichedLink`. The enrichment is inline and synchronous within the collector phase — one shared `EnrichmentContext` per run carries the URL cache, counters, and abort signal.

## Public surface
- `enrichRawItems(items, ctx)` → `RawItemInsert[]` — mutates each item in-place, attaching `metadata.enrichedLink`
- `enrichOne(originalUrl, canonical, ctx)` → `EnrichedLinkContent` — fetches + converts a single URL
- `shouldEnrich(item, cache)` → `ShouldEnrichResult` — decides whether to enrich (skip self-posts, same-platform, non-HTML media, cache hits)
- `canonicalizeEnrichmentUrl(url)` → `string | null` — strips tracking params, normalizes for cache key
- `getContentType(url)` → `"html" | "pdf" | "image" | "video" | "other"` — content type classification
- `createEnrichmentCache()` → `Map<string, EnrichedLinkContent>` — per-run URL→result cache
- `newCounters()` → `EnrichmentCounters` — fresh counter object
- `toEnrichmentTelemetry(counters)` → `EnrichmentTelemetry` — snapshot for run_archives.sourceTelemetry
- `isPrivateOrLoopbackHost(host)` → `boolean` — re-exported safety check

## Depends on / used by
- Uses: `@pipeline/services/web-fetch` (fetchAdaptive), `@newsletter/shared`
- Used by: `collectors/hn.ts`, `collectors/reddit.ts`, `collectors/twitter/index.ts`, `collectors/web-search/index.ts`

## Data flows

### enrichRawItems(items, ctx) → RawItemInsert[]
  for each item:
    ├─ signal aborted → attach { status: "failed", failureReason: "cancelled" }
    ├─ shouldEnrich → skipReason="cache-hit" → copy from ctx.cache with cacheHit:true
    ├─ shouldEnrich → skip (same-platform, self-post, etc.) → attach { status: "skipped", skipReason }
    └─ shouldEnrich → enrich → enrichOne(url, canonical, ctx)
          ├─ ok → attach enriched → ctx.cache.set(canonical, result)
          └─ failed/timeout → attach { status: "failed", failureReason }
  (each item is mutated in-place; the same array is returned)

### shouldEnrich(item, cache) → ShouldEnrichResult
  item.url:
    ├─ empty / === sourceUrl → { enrich: false, skipReason: "no-url" }
    ├─ canonicalizeEnrichmentUrl → null → { enrich: false, skipReason: "invalid-url" }
    ├─ host matches SAME_PLATFORM_HOSTS (reddit.com, x.com, news.ycombinator.com, etc.) → skip "same-platform"
    ├─ path has media extension / host is YouTube/Vimeo/Imgur → skip "non-html-media"
    ├─ canonical in cache → skip "cache-hit"
    └─ else → { enrich: true, canonical }

## Gotchas / landmines
- **In-place mutation**: `enrichRawItems` mutates items in-place and returns the same array. Collectors must pass the array through `upsertItems` after enrichment — the attached `metadata.enrichedLink` is what the rank-body-loader and preview renderers read. (D-080)
- **15s per-URL timeout**: `enrichOne` uses `AbortSignal.timeout(15000)`. Slow pages are classified as `timeout` failures and logged but don't block other enrichments.
- **No retry**: Enrichment failures are terminal — the item gets `status: "failed"` and moves on. The ranker's body-loader can still fire a live fetch at rank time.

## Decisions
- **D-080**: In-place enrichment with per-run cache. Why: URLs shared across items (e.g. two HN stories linking the same blog) should only be fetched once per run. The cache lives on `EnrichmentContext` scoped to the run. Tradeoff: the cache is a plain Map, not LRU — acceptable for typical run sizes (<200 URLs). Governs: `services/link-enrichment/index.ts`.
