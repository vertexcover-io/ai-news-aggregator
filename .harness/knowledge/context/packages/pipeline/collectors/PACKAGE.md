---
governs: packages/pipeline/src/collectors/
last_verified_sha: ad0153a
key_files: [hn.ts, reddit.ts, web.ts, web-date.ts]
flow_fns: [hn.ts::collectHn, reddit.ts::collectReddit, web.ts::collectWeb, web.ts::discoverPostUrls, web.ts::extractPostFields, web-date.ts::resolvePublishedDate]
decisions: [D-010, D-011, D-012]
status: active
---

# collectors/ — fetch AI news from external sources and upsert into raw_items

## Purpose
Each collector function fetches from a specific source API, transforms responses directly to `RawItemInsert[]`, optionally enriches external URLs, upserts to PostgreSQL via `RawItemsRepo`, and returns a `CollectorResult`. All collectors also export single-post fetchers for the add-post flow.

## Public surface
- `collectHn(deps, config)` → `CollectorResult` — batch collect from HN via Algolia API, fetches top comments per item
- `collectReddit(deps, config)` → `CollectorResult` — batch collect from Reddit via Apify actor `trudax/reddit-scraper-lite`; RSS/jsdom removed
- `collectWeb(deps, config)` → `WebCollectorResult` — two-pass web collector: Pass 1 listings via Crawlee, Pass 2 details via Crawlee + LLM extraction
- `collectTwitter(deps, config)` → `CollectorResult` — batch collect from X/Twitter lists + user timelines via Rettiwt
- `collectWebSearch(deps, config)` → `CollectorResult` — batch collect from web search provider (Tavily)
- `fetchHnPost(url, deps)` → `RawItemInsert` — single-post fetch for add-post flow
- `fetchRedditPost(url, deps)` → `RawItemInsert` — single-post fetch for add-post flow
- `fetchWebPost(url, deps)` → `RawItemInsert` — single-post fetch for add-post flow (generic web)
- `fetchTwitterPost(url, deps)` → `RawItemInsert` — single-tweet fetch for add-post flow
- `discoverPostUrls(listingUrl, markdown, structuredData, model, reportUsage?)` → `DiscoveredPost[]` — LLM extracts post URLs/dates from listing page markdown
- `extractPostFields(postUrl, markdown, model, reportUsage?)` → `ExtractedFields` — LLM extracts title/author/date/image from detail page markdown
- `resolvePublishedDate(raw, referenceDate)` → `Date | null` — resolves relative/natural-language dates via chrono-node
- `buildRawItem(postUrl, markdown, fields, structuredPublishedAt?)` → `RawItemInsert` — constructs a raw_item from extracted fields
- `validateDiscoveredUrls(posts, listingUrl)` → `DiscoveredPost[]` — resolves relative URLs, drops non-http(s)
- `sortPostsByPublishedAtDesc(posts, referenceDate?)` → `DiscoveredPost[]` — sorts by resolved date descending
- `applySinceDays(posts, sinceDays, referenceDate?)` → `DiscoveredPost[]` — filters posts to within N days
- `parseHnItemIdFromUrl(url)` → `string | null` — extracts HN item ID from news.ycombinator.com or hn.algolia.com URLs
- `parseRedditPostUrl(url)` → Reddit URL parse result
- `parseTweetIdFromUrl(url)` → `string | null` — extracts tweet ID from x.com/twitter.com status URLs

## Depends on / used by
- Uses: `@newsletter/shared` (types, logger), `@pipeline/repositories/raw-items`, `@pipeline/services/link-enrichment`, `@pipeline/services/web-crawler`, `@pipeline/services/web-fetch`, `crawlee`, `@ai-sdk/deepseek`, `rettiwt-api`, `@tavily/core`, `chrono-node`, `jsdom` (web-fetch only; Reddit no longer uses it), `apify-client` (Reddit collector)
- Used by: `workers/run-process.ts`, `services/add-post/dispatch.ts`

## Data flows

### collectHn(deps, config) → CollectorResult
  config → feeds.map(buildSearchUrl) → Algolia search API
    ├─ feed completed  → parseStories → RawItemInsert[]
    └─ all feeds done  → fetchComments (per item, rate-limited)
                          → enrichRawItems (inline URL enrichment)
                            → rawItemsRepo.upsertItems → CollectorResult
  (HN collector uses Algolia `search_by_date` for "newest" feed, `search` for "best")

### collectWeb(deps, config) → WebCollectorResult
  config.sources → Pass 1: Crawlee listing crawl
    ├─ listing failed  → per-source failure
    └─ listing ok      → discoverPostUrls (LLM, deepseek-chat, feeds markdown + JSON-LD)
                          → validateDiscoveredUrls (resolve relative, drop invalids)
                            → sortPostsByPublishedAtDesc → applySinceDays → cap to maxItems
                              → Pass 2: Crawlee detail crawl (only for non-existing, non-self-ref URLs)
                                ├─ detail ok     → extractPostFields (LLM, deepseek-chat)
                                │                    → buildRawItem → allItems[]
                                └─ detail failed → per-post failure
                                  → rawItemsRepo.upsertItems → WebCollectorResult
  (web-search collector skips detail crawl for self-referential URLs that resolve back to listing page)
  (all sources failed → throws; partial failure → returns items from successful sources)

### discoverPostUrls(listingUrl, listingMarkdown, structuredData, model, reportUsage?) → DiscoveredPost[]
  listingMarkdown + structuredData → combined (cap 120K chars) → generateObject(model, DiscoverySchema)
    → reportUsage(usage) → result.object.posts
  (LLM extracts {url, title, published_at} per post from markdown)

### collectReddit(deps, config) → CollectorResult
  resolveToken() → Apify API token (DB-first, env APIFY_API_KEY fallback, null → empty result)
    → token present → runRedditListing(apiToken, startUrls, input) via `apify-client` (actor: trudax/reddit-scraper-lite)
      → items grouped by parsedCommunityName → dedup by externalId → sinceDays filter → per-sub cap to config.limit
        → mapApifyPostToRawItem → enrichRawItems (inline URL enrichment)
          → rawItemsRepo.upsertItems → CollectorResult {unitResults per subreddit}
    → token absent → CollectorResult {itemsStored:0} (no throw, warns)
  (fetchRedditPost: same token resolution → single-permalink actor run → returns RawItemInsert)

## Gotchas / landmines
- **Reddit uses Apify, not RSS**: As of the Apify migration, `collectReddit` calls the `trudax/reddit-scraper-lite` Apify actor — no RSS feed, no jsdom, no `*.rss` URLs. The Apify API token is a platform-level secret stored in `app_credentials` under key `apify_api_token`, set by a super-admin, and resolved DB-first (fallback to `APIFY_API_KEY` env var). No token → empty CollectorResult (logs a warning; does not crash the run).
- **Web collector uses DeepSeek, not Anthropic**: `discoverPostUrls` and `extractPostFields` run on `deepseek-chat` (V4 Flash) via `@ai-sdk/deepseek`, distinct from the Anthropic-based shortlist/rerank/recap stages. Requires `DEEPSEEK_API_KEY`. (D-010)
- **Crawlee rejects invalid URLs atomically**: A single non-http(s) URL in `addRequests` aborts the entire crawl batch. `validateDiscoveredUrls` drops them before enqueue, and `runWebCrawl` has a redundant `isCrawlableUrl` backstop. (D-011)
- **self-referential linking URLs skip Pass 2**: The web collector checks `resolvesToListing(postUrl, listingUrl)` — if true, the post URL resolves to the listing page itself (e.g. anchor links), the detail crawl is skipped and a RawItemInsert is built from discovery-only data. (D-012)
- **Twitter collector returns `auth` failure on missing cookies**: Does NOT crash the run — the per-source error is surfaced in the Slack source-distribution notice without aborting other collectors.

## Decisions
- **D-010**: Web collector LLM calls use DeepSeek not Anthropic. Why: cost (DeepSeek is cheaper for high-volume extraction) and capability (DeepSeek V4 Flash handles structured extraction well). Tradeoff: requires a second API key. Governs: `collectors/web.ts`.
- **D-011**: Dual-layer URL validation (validateDiscoveredUrls + isCrawlableUrl backstop). Why: a single bad URL aborts the entire Crawlee batch; the LLM can return relative/empty/invalid URLs. Tradeoff: two validation sites to keep in sync. Governs: `collectors/web.ts`, `services/web-crawler.ts`.
- **D-012**: Skip detail crawl for self-referential listing URLs. Why: Crawlee's detail crawl of the listing page itself returns the listing HTML (not the post), and the LLM would extract the wrong content. The discovery-data-only fallback preserves the item without a wasted crawl. Governs: `collectors/web.ts`.
