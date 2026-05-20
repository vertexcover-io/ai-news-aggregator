# Web-Search Collector — Spec

**Status:** ready-to-implement
**Date:** 2026-05-20
**Design doc:** [design.md](./design.md)
**Library probe:** [library-probe.md](./library-probe.md)
**Selected SDK:** `@tavily/core@0.7.3` (verified live, see probe log)

---

## Summary

Add a new `web-search` collector that surfaces niche AI news (agentic AI, context engineering, AI coding, …) from the open web. Admin enters raw search queries via the Settings page; the collector runs each query through a pluggable `WebSearchProvider` (Tavily as the default and only provider in this PR) and feeds resulting articles into the existing pipeline (link-enrichment → dedup → ranking → archive).

## Requirements

### REQ-001 — Pluggable provider interface

The collector MUST NOT import or reference any specific provider SDK. It uses a `WebSearchProvider` interface (`packages/pipeline/src/collectors/web-search/providers/types.ts`):

```ts
export interface WebSearchProvider {
  readonly name: string;
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
  snippet: string;
  publishedAt: Date | null;
  imageUrl?: string;
  rawScore?: number;
  providerMetadata?: Record<string, unknown>;
}
```

Adding a future provider = one new file implementing `WebSearchProvider` + one line in the factory. No collector changes.

### REQ-002 — Tavily provider

`TavilyProvider` (`packages/pipeline/src/collectors/web-search/providers/tavily.ts`) implements `WebSearchProvider`:

- Constructor: `new TavilyProvider({ apiKey: string })`.
- `name: "tavily"`.
- `search(input)` calls `tavily({ apiKey }).search(input.query, { topic: "news", days: input.sinceDays, maxResults: input.maxItems, includeImages: true, includeRawContent: false })`.
- Maps each `TavilyResult` → `WebSearchResult`:
  - `title` → `title`
  - `url` → `url`
  - `content` → `snippet`
  - `publishedDate` → `publishedAt` (via `new Date(...)`; on parse failure or missing, `null`)
  - `score` → `rawScore`
  - `imageUrl`: undefined (top-level `images[]` is query-level, not per-article — link-enrichment fills the per-article image downstream)
  - `providerMetadata`: `{ favicon, score }`
- AbortSignal: passed through to the SDK if the SDK call supports it; otherwise the surrounding `Promise.race` is implemented at the collector level.
- Errors: HTTP/SDK errors bubble up as thrown `Error` with `cause` set to the original. The collector catches per-query.

**Field-name source of truth:** the live probe at `.harness/web-search-collector/probes/usage-shape.live.log` (committed for reference but lives under `.harness/`, which is gitignored — re-runnable via `.harness/web-search-collector/probes/probe.mjs`).

### REQ-003 — Provider factory

`createWebSearchProvider(name, env)` in `packages/pipeline/src/collectors/web-search/providers/index.ts`:

- `name === "tavily"`: requires `env.tavilyApiKey`; throws `new Error("TAVILY_API_KEY is required for the tavily web-search provider")` if missing.
- Future names: union widen.

The factory is called from the pipeline wiring (NOT from the collector).

### REQ-004 — Collector

`collectWebSearch(deps, config)` in `packages/pipeline/src/collectors/web-search/index.ts`:

**Algorithm:**
1. For each `query` in `config.queries`, call `provider.search(...)` in parallel via `Promise.allSettled`.
2. For each successful query result set, map each `WebSearchResult` → `RawItemInsert`:
   - `sourceType: "web_search"`
   - `externalId: "<provider>:" + sha256(url)` — provider-prefixed for safety if we ever run multi-provider.
   - `title`, `url`, `content: snippet`, `imageUrl: result.imageUrl ?? null`, `publishedAt: result.publishedAt ?? new Date()` (when null, use `collectedAt` as fallback — same convention as Reddit when `created_utc` is absent), `sourceUrl: url`, `author: null`, `engagement: {}`, `metadata: { provider, query, rawScore }`.
3. Dedup the combined item list by `url`: when two queries surface the same URL, keep the one with higher `rawScore` (ties: first wins). Track the dropped item count for `unitResults`.
4. If `deps.enrichment` is provided, call `enrichRawItems(items, deps.enrichment)`.
5. Upsert via `deps.rawItemsRepo.upsertItems(items)`.
6. Return `CollectorResult`:
   - `itemsFetched`: total results received from all queries (pre-dedup).
   - `commentsFetched: 0`.
   - `itemsStored`: post-dedup count actually upserted.
   - `durationMs`.
   - `unitResults`: one entry per query with `sourceKey: "web_search:<query-hash>"`, `itemsFetched`, `itemsStored`, `error?`.

**Failure semantics:**
- Per-query failure → that query's `unitResults` entry has `error: <message>`, `itemsFetched: 0`, `itemsStored: 0`. Other queries still process.
- All queries fail → collector still returns a `CollectorResult` (with zero items); the run keeps going (same as Reddit when all subreddits 5xx).
- `provider.search` throwing a credential error → caught per-query.

### REQ-005 — Settings schema (DB + types)

Add to `packages/shared/src/db/schema.ts` `user_settings` table:

```ts
webSearchEnabled: boolean("web_search_enabled").notNull().default(false),
webSearchConfig: jsonb("web_search_config")
  .$type<WebSearchRunConfig>()
  .notNull()
  .default(sql`'{"provider":"tavily","queries":[]}'::jsonb`),
```

Add to `packages/shared/src/types/run.ts`:

```ts
export type WebSearchProviderName = "tavily";

export interface WebSearchQueryConfig {
  query: string;       // 1..400 chars, trimmed
  sinceDays: number;   // 1..30 integer
  maxItems: number;    // 1..20 integer
}

export interface WebSearchRunConfig {
  provider: WebSearchProviderName;
  queries: WebSearchQueryConfig[];  // 0..25 entries
}
```

Add to `RunSubmitConfig` / `RunCollectorsPayload`:

- `webSearch?: WebSearchRunConfig;` on `RunSubmitConfig`.
- A `webSearch: true` flag on `RunCollectorsPayload` (mirrors `hn`, `reddit`, `twitter`).

Generate migration via `pnpm --filter @newsletter/shared db:generate`. Commit the generated `.sql` and `_meta/` files.

### REQ-006 — Settings API + zod validation

The existing `PUT /api/settings` handler (`packages/api/src/routes/settings.ts`) gets two new optional fields in its zod schema:

```ts
webSearchEnabled: z.boolean().optional(),
webSearchConfig: z.object({
  provider: z.literal("tavily"),
  queries: z.array(z.object({
    query: z.string().trim().min(1).max(400),
    sinceDays: z.number().int().min(1).max(30),
    maxItems: z.number().int().min(1).max(20),
  })).max(25),
}).optional(),
```

Repository (`packages/api/src/repositories/user-settings.ts`) `upsert()` and `toDomain()` get the two new fields. `GET /api/settings` returns them. `GET /api/admin/me` (or whatever the settings hydration route is) — same.

### REQ-007 — Admin UI

A new card on `/admin/settings`, immediately after the Twitter card:

- **Title:** "Web Search"
- **Provider badge:** "Tavily" (greyed, no selector).
- **Enable toggle** (bound to `webSearchEnabled`).
- **Queries** (array editor):
  - Each row: `query` text input (placeholder "e.g. agentic AI news"), `sinceDays` number input (default 7), `maxItems` number input (default 10), Remove (×) button.
  - "Add query" button under the list.
- **Save** is the existing Settings page Save button (single PUT).

Form state: React Hook Form (consistent with other settings cards). Validation matches REQ-006 zod schema (client mirror).

### REQ-008 — Pipeline wiring

`packages/pipeline/src/workers/run-process.ts → runCollecting()`:

```ts
if (collectorsPayload.webSearch && settings.webSearchEnabled && settings.webSearchConfig.queries.length > 0) {
  const provider = createWebSearchProvider(settings.webSearchConfig.provider, {
    tavilyApiKey: env.TAVILY_API_KEY,
  });
  tasks.push({
    sourceKey: "web_search",
    run: () => collectWebSearch(
      { rawItemsRepo, provider, logger, signal, enrichment },
      { queries: settings.webSearchConfig.queries },
    ),
  });
}
```

Daily-run path (in scheduler / daily-run handler) builds `webSearch: settings.webSearchEnabled` into `RunCollectorsPayload`. Same as the existing pattern for HN/Reddit/Twitter.

### REQ-009 — `sourceType` constant

`"web_search"` is added to the `SOURCE_TYPES` constant / union in `@newsletter/shared/constants` so the DB constraint, raw-items repo, and downstream dedup / ranking know it's a valid source type.

### REQ-010 — Env var

Add to `.env.example`:

```
# Web-search collector (Tavily provider)
TAVILY_API_KEY=
```

No code in `@newsletter/api` reads this — only `@newsletter/pipeline`. (Both packages already have dotenv bootstraps; pipeline's existing bootstrap covers it.)

---

## Out of scope (this PR)

- Brave / Exa / Serper providers.
- Provider selector in the UI (the field exists in config but is locked to "tavily" by the zod schema).
- Per-query analytics on the Run Archive page.
- Custom Tavily params (`includeDomains`, `excludeDomains`, `searchDepth`) — defaults are good enough for MVP; we can expose later via a JSON-edit advanced toggle.

---

## Verification Scenarios

These scenarios are executed in Stage 5 (functional-verify) against a live Tavily key.

### VS-0.1 — Tavily SDK live call (probe re-run)

**Pre:** `TAVILY_API_KEY` present.

**Steps:**
1. `await tavily({ apiKey }).search("agentic AI", { topic: "news", days: 7, maxResults: 5, includeImages: true, includeRawContent: false })`.

**Expected:**
- Returns within 10s.
- `res.results.length >= 1`.
- Each result has `title`, `url`, `content`, `score`, `publishedDate`.

### VS-0.2 — Collector multi-query roundtrip

**Pre:** `TAVILY_API_KEY` present; in-memory mock `rawItemsRepo`; real `TavilyProvider`.

**Steps:**
1. `await collectWebSearch({ rawItemsRepo, provider, logger, signal: undefined }, { queries: [{query:"agentic AI", sinceDays:7, maxItems:3}, {query:"context engineering LLM", sinceDays:14, maxItems:3}] })`.

**Expected:**
- `result.itemsFetched >= 2 && <= 6`.
- `result.unitResults.length === 2`.
- All upserted items: `sourceType === "web_search"`, `metadata.provider === "tavily"`.

### VS-0.3 — URL dedup across queries

**Pre:** Mock provider returns the same `https://example.com/x` for both queries (different `rawScore`).

**Steps:**
1. Run `collectWebSearch` with two queries; provider returns one shared URL plus one unique per query.

**Expected:**
- `itemsFetched: 4`, `itemsStored: 3`.
- The kept duplicate has the higher `rawScore`.
- Mock repo's upsertItems was called with 3 distinct URLs.

### VS-0.4 — Missing API key

**Pre:** `TAVILY_API_KEY` unset.

**Steps:**
1. Call `createWebSearchProvider("tavily", { tavilyApiKey: undefined })`.

**Expected:**
- Throws with message containing `TAVILY_API_KEY`.

### VS-0.5 — Settings round-trip (admin UI ↔ DB)

**Steps:**
1. Log into `/admin`, open Settings.
2. Enable Web Search, add a query `{ query: "agentic AI", sinceDays: 7, maxItems: 10 }`, save.
3. Reload page.
4. Inspect `user_settings.web_search_config` in Postgres.

**Expected:**
- Page re-hydrates with the saved query.
- DB row contains `web_search_enabled = true` and the queries jsonb matches input.

### VS-0.6 — Validation rejects bad input

**Steps:**
1. PUT `/api/settings` with `webSearchConfig: { provider: "tavily", queries: [{ query: "", sinceDays: 0, maxItems: 999 }] }`.

**Expected:**
- 400 response; zod error mentions `query`, `sinceDays`, and `maxItems`.

### VS-0.7 — End-to-end pipeline run

**Pre:** Web Search enabled with 1 query; HN/Reddit/Twitter disabled.

**Steps:**
1. Trigger "Run Now" from the dashboard.

**Expected:**
- Run completes (`status: success`).
- `raw_items` has new rows with `source_type = 'web_search'`.
- Run archive has ranked items including at least one `web_search` source.

---

## Files touched (preview — final list lives in plan.md)

- `packages/shared/src/db/schema.ts` — two new columns
- `packages/shared/src/db/migrations/<NNNN>_*.sql` — generated
- `packages/shared/src/types/run.ts` — new types
- `packages/shared/src/types/settings.ts` — `UserSettings` adds two fields
- `packages/shared/src/constants/index.ts` — add `"web_search"` to source types
- `packages/api/src/repositories/user-settings.ts` — toDomain + upsert
- `packages/api/src/routes/settings.ts` — zod schema fields
- `packages/api/src/routes/runs.ts` (if it exposes collector flags) — wire `webSearch`
- `packages/pipeline/src/collectors/web-search/index.ts` — collector
- `packages/pipeline/src/collectors/web-search/providers/types.ts` — interface
- `packages/pipeline/src/collectors/web-search/providers/tavily.ts` — implementation
- `packages/pipeline/src/collectors/web-search/providers/index.ts` — factory
- `packages/pipeline/src/workers/run-process.ts` — task registration
- `packages/pipeline/src/workers/scheduler.ts` (or daily-run handler) — daily payload includes web-search
- `packages/web/src/pages/admin/Settings.tsx` (or wherever cards live) — new card
- `packages/web/src/lib/settings-schema.ts` (or equivalent client zod) — mirror
- `.env.example` — `TAVILY_API_KEY`
- `package.json` (pipeline) — add `@tavily/core` dep

## Tests

- **Unit (collector):** `packages/pipeline/tests/unit/collectors/web-search.test.ts`
- **Unit (provider):** `packages/pipeline/tests/unit/collectors/web-search/tavily-provider.test.ts`
- **Unit (factory):** `packages/pipeline/tests/unit/collectors/web-search/providers-factory.test.ts`
- **API unit (settings):** add cases to existing settings repo + route tests
- **E2E (UI):** add a Playwright spec covering VS-0.5 round-trip
