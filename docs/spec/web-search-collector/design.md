# Web-Search Collector — Design

**Status:** draft
**Author:** Aman + Claude
**Date:** 2026-05-20
**Linear:** (to be linked)

## Problem

The 34 existing sources skew toward platform-native firehoses (HN, Reddit, Twitter, RSS). Genuinely interesting niche AI news — *agentic AI*, *context engineering*, *AI coding tooling*, and similar pockets — frequently breaks first on independent blogs, vendor posts, and small publications that *no* feed indexes. We have no way to surface that content.

We need a collector that:

1. Accepts admin-defined **raw search queries** (the user types the query verbatim — no synthesis from "topics" or "terms"); each query becomes a separate search.
2. Supports `sinceDays` (recency window) and `maxItems` (cap per query), matching the pattern of HN/Reddit collectors.
3. Sits behind a **pluggable provider interface** so we can swap Tavily → Brave → Exa later without rewriting the collector.
4. Plugs into the existing pipeline: returns `RawItemInsert[]`, integrates with link-enrichment, dedup, ranking — same as every other collector.

## Non-goals

- Building our own crawler or SERP scraper.
- Subscription-style alerting (Tavily's separate `extract`/`crawl` endpoints — out of scope).
- Adding multi-provider failover at runtime. One provider is selected per run; if it errors, the collector fails its source and the rest of the run continues (same semantics as every other collector today).
- Auto-deriving queries from "topics" — user enters full queries themselves.

## Approach

### High level

```
admin UI (web)
   │
   │  PUT /api/settings { webSearchEnabled, webSearchConfig: { queries: [...] } }
   ▼
user_settings row (jsonb webSearchConfig)
   │
   ▼
pipeline run-process.ts → runCollecting() → collectWebSearch(deps, config)
                                                   │
                                                   ▼
                                       WebSearchProvider interface
                                                   │
                                       ┌───────────┴───────────┐
                                       ▼                       ▼
                                TavilyProvider           (future) BraveProvider
                                       │
                                       ▼
                                 RawItemInsert[]
                                       │
                              link-enrichment (shared)
                                       │
                              dedup / rank / archive
```

### Provider interface

```ts
// packages/pipeline/src/collectors/web-search/providers/types.ts
export interface WebSearchProvider {
  readonly name: string; // "tavily" | "brave" | ...

  search(input: {
    query: string;
    sinceDays: number;
    maxItems: number;
    signal?: AbortSignal;
  }): Promise<WebSearchResult[]>;
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;           // short blurb from the provider
  publishedAt: Date | null;  // null when the provider can't infer one
  imageUrl?: string;
  rawScore?: number;         // provider's own relevance score, if any
  providerMetadata?: Record<string, unknown>;
}
```

Why this shape:
- Tavily returns `{ title, url, content, score, published_date, ... }` natively — a thin adapter to `WebSearchResult`.
- Brave's news endpoint returns `{ title, url, description, age, page_age, thumbnail }` — same adapter, different field names.
- Exa returns `{ title, url, text, publishedDate, score }` — same.

A new provider = one file implementing `WebSearchProvider`. No touch to the collector or wiring.

### Provider factory

```ts
// packages/pipeline/src/collectors/web-search/providers/index.ts
export function createWebSearchProvider(
  name: WebSearchProviderName,
  env: { tavilyApiKey?: string; /* future: braveApiKey? */ },
): WebSearchProvider { ... }
```

`WebSearchProviderName` is a string union (`"tavily"` initially). The factory throws a clear error if the selected provider's credentials are missing — caught by the collector and surfaced as a per-source failure (consistent with existing missing-credential behavior in Twitter/Reddit).

### Tavily adapter (default provider)

- Library: **`@tavily/core`** (official Node SDK) — verified live in Stage 1.5.
- Endpoint: `tavily.search(query, { topic: "news", days, maxResults, includeImages: true, includeRawContent: false })`.
- Mapping:
  - `result.title` → `title`
  - `result.url` → `url`
  - `result.content` → `snippet`
  - `result.published_date` → `publishedAt` (parse, null on failure)
  - `result.score` → `rawScore`
  - `images[0]` → `imageUrl` (when available)
- API key: `TAVILY_API_KEY` env var.

### Collector

```ts
// packages/pipeline/src/collectors/web-search/index.ts
export interface WebSearchCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  provider: WebSearchProvider;
  logger?: Logger;
  signal?: AbortSignal;
  enrichment?: EnrichmentContext;
}

export interface WebSearchCollectorConfig {
  queries: WebSearchQuery[];
}

export interface WebSearchQuery {
  query: string;
  sinceDays: number;   // required per-query
  maxItems: number;    // required per-query
}

export async function collectWebSearch(
  deps: WebSearchCollectorDeps,
  config: WebSearchCollectorConfig,
): Promise<CollectorResult>;
```

Algorithm:
1. For each query, call `provider.search(...)`. Run queries **concurrently** with `Promise.allSettled` (mirrors how multiple subreddits are handled inside the Reddit collector).
2. Map each `WebSearchResult` → `RawItemInsert`:
   - `sourceType: "web_search"`
   - `externalId: <provider>:<sha256(url)>` (URL-stable; prefixing with provider avoids cross-provider collisions if we ever run two providers in one run)
   - `title`, `url`, `content` (← snippet), `imageUrl`, `publishedAt`
   - `metadata`: `{ provider: "tavily", query: "<the query that surfaced it>", rawScore }` — so we can debug which query found what and which provider's score it had.
3. Dedup within the collector run by `url` (same article often surfaces in multiple queries).
4. Pass items to `enrichRawItems(...)` when `deps.enrichment` is provided (same as Reddit/HN/Twitter do today).
5. Upsert via `rawItemsRepo.upsertItems(...)`.
6. Return `{ itemsFetched, commentsFetched: 0, itemsStored, durationMs, unitResults }` where `unitResults` has one entry per query (`sourceKey: "web_search:<query>"`, fetched/stored counts, error if any).

The collector NEVER imports a specific provider — only `WebSearchProvider`. Provider instantiation happens in the pipeline wiring.

### Settings + DB

Add to `user_settings` (singleton row):

```sql
ALTER TABLE user_settings
  ADD COLUMN web_search_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN web_search_config jsonb NOT NULL DEFAULT '{"provider":"tavily","queries":[]}'::jsonb;
```

JSONB shape (`WebSearchRunConfig` in `@newsletter/shared/types/run.ts`):

```ts
export interface WebSearchRunConfig {
  provider: "tavily";        // string union, future-extensible
  queries: WebSearchQueryConfig[];
}
export interface WebSearchQueryConfig {
  query: string;             // raw user-entered string
  sinceDays: number;         // 1..30
  maxItems: number;          // 1..20  (Tavily's per-call max)
}
```

Provider selection lives in `web_search_config.provider`, not in env, because down the road we may want different runs to use different providers (e.g. budget vs. fidelity). For now it's locked to `"tavily"` by the zod schema — adding `"brave"` is a one-line union widen.

### Admin UI

A new card on `/admin/settings`, mirroring the Reddit/HN cards:

- **Enable toggle** — `webSearchEnabled`.
- **Provider readonly badge** — "Tavily" (greyed; placeholder for future selector).
- **Queries list** — an array editor. Each row:
  - Query text (free-form, max 400 chars).
  - `sinceDays` (number input, 1–30, default 7).
  - `maxItems` (number input, 1–20, default 10).
  - Remove button.
- **Add query** button.
- Save uses the existing `PUT /api/settings` flow.

Validation is server-side via zod (rejects empty queries, out-of-range numbers, more than 25 queries total).

### Pipeline wiring

In `run-process.ts → runCollecting()` add a new branch:

```ts
if (collectorsPayload.webSearch && settings.webSearchEnabled) {
  const provider = createWebSearchProvider(settings.webSearchConfig.provider, env);
  tasks.push({
    sourceKey: "web_search",
    run: () => collectWebSearch(
      { rawItemsRepo, provider, logger, signal, enrichment },
      { queries: settings.webSearchConfig.queries },
    ),
  });
}
```

Daily-run job builds the `RunCollectorsPayload` from settings — same pattern HN/Reddit follow.

## External Dependencies & Fallback Chain

This is the section the library-probe will verify in Stage 1.5.

| Dep | Purpose | Verified by probe | Fallback if probe fails |
|-----|---------|-------------------|-------------------------|
| `@tavily/core` (npm) | Tavily Node SDK — `search()` with `topic: "news"`, `days`, `maxResults` | Live call with `TAVILY_API_KEY` → assert non-empty results for a known-good query (e.g. `"agentic AI"`, `days: 7`) and that `published_date` is present on news topic | Fall back to raw `fetch` against `https://api.tavily.com/search` (documented JSON contract — same fields). If Tavily itself is unreachable: stop and prompt user to choose Brave or Exa. |
| `TAVILY_API_KEY` env var | Authentication | Probe asserts the key is present, valid, and not exhausted (HTTP 200 from a 1-result query) | If missing: probe blocks; user adds it to `.env`. |

If the SDK's surface differs from what we expect (e.g. `topic` no longer accepts `"news"`, or `days` is removed), the probe captures the actual shape and either:
- spec-generation folds the new shape into the contract, or
- we switch to the raw HTTP API (no SDK dep).

## Tests

- **Unit**: `tests/unit/collectors/web-search.test.ts` with mocked `WebSearchProvider` (just a `vi.fn()` returning canned `WebSearchResult[]`). Verifies mapping, dedup, enrichment call, repo upsert.
- **Provider unit**: `tests/unit/collectors/web-search/tavily-provider.test.ts` with mocked SDK to verify field mapping (no network).
- **API + UI e2e** (mandatory — this PR touches both routes and the admin page):
  - Settings round-trip: PUT `/api/settings` with `webSearchConfig`, GET, assert it persists and validates.
  - Admin UI: enable web-search, add a query, save, reload, assert form re-hydrates from the server.

## Open questions

None blocking. (Provider was explicitly chosen as Tavily; query model was explicitly chosen as raw user queries; pluggable interface was the explicit user requirement.)

## Out of scope (future tickets)

- Brave/Exa providers.
- Auto-clustering near-duplicate articles across queries (the existing dedup-by-URL is sufficient for MVP).
- Per-query scoring tuning (we just trust Tavily's `score` as `rawScore` and let stage-2 rerank handle final ordering).
