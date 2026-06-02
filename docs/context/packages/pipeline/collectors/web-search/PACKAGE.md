---
governs: packages/pipeline/src/collectors/web-search/
last_verified_sha: 5a2ff20
key_files: [index.ts, providers/types.ts, providers/tavily.ts, providers/index.ts]
flow_fns: [index.ts::collectWebSearch, providers/tavily.ts::TavilyProvider.search]
decisions: [D-030]
status: active
---

# collectors/web-search/ — open-web search collector with pluggable provider interface

## Purpose
Collects items from open-web search APIs (currently Tavily) by running configured queries, URL-deduping results (keeping highest `rawScore` winner), and upserting to `raw_items`. The provider interface (`WebSearchProvider`) is designed for future providers to be added with one new file + one factory line.

## Public surface
- `collectWebSearch(deps, config)` → `CollectorResult` — runs all config queries through provider, dedups by URL, enriches, upserts
- `createWebSearchProvider(name, env)` → `WebSearchProvider` — factory; currently only "tavily"
- `WebSearchProvider` interface — `{ name, search(input) → WebSearchResult[] }`
- `TavilyProvider` class — implements `WebSearchProvider` using `@tavily/core`

## Depends on / used by
- Uses: `@tavily/core`, `@newsletter/shared`, `@pipeline/repositories/raw-items`, `@pipeline/services/link-enrichment`
- Used by: `workers/run-process.ts`, `workers/processing.ts`

## Data flows

### collectWebSearch(deps, config) → CollectorResult
  config.queries → Promise.allSettled over queries × provider.search
    ├─ query rejected  → per-query failure → unitResult { status: "failed" }
    └─ query fulfilled → map results → { sourceType: "web_search", externalId: "tavily:<sha256(url)>" }
                          → dedup by URL (keep higher rawScore)
                            → enrichRawItems → rawItemsRepo.upsertItems → CollectorResult
  (provider is resolved at worker startup from TAVILY_API_KEY; disabled when unset)

## Gotchas / landmines
- **No per-item content**: Web search results carry only snippets — no full article body. The rank-body-loader will fire a live fetch for these items at rank time.
- **TAVILY_API_KEY nullable**: When unset, the provider is never created. The run-process worker skips the webSearch task gracefully (warn log, no crash). (D-030)

## Decisions
- **D-030**: Web search provider resolved at worker startup, not per-job. Why: Tavily is env-driven only (no DB credential equivalent), so process-startup resolution is correct — no freshness contract to violate. Tradeoff: changing TAVILY_API_KEY requires a worker restart (acceptable — env vars are static by convention). Governs: `workers/processing.ts::buildDefaultRunProcessDeps`.
