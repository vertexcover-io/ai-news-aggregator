# SPEC — Run Telemetry: Live Logs, Verbose Failures, Source-Items Dropdown Fix

**Design:** `docs/spec/run-telemetry-live-logs/design.md`
**Status:** ready-for-planning

## Goal

Operators viewing `/admin/runs/:runId` (Run Telemetry page) can:
- See web-collector and crawler events in the Debug Timeline as they happen (≤2 s after emit, via the existing react-query poll).
- See each link-enrichment failure as a Failure Card with the URL and failure reason.
- Open the per-source items dropdown for any source row and find the actual items collected — the count in the row matches the dropdown contents.
- Filter the Debug Timeline by ALL / Info / Warn / Error and have every routed event labelled at the correct level.

## Functional Requirements (EARS)

### REQ-001 — Web collector milestone events reach `run_logs`
**When** the web collector emits an event in {`collector.web.listing_completed`, `collector.web.discovery_failed`, `collector.web.discovery_completed`, `web.extract.start`, `web.extract.complete`, `web.extract.failed`, `web.enrichment.skip`, `web.enrichment.complete`, `web.collect.failed`, `collector.web.completed`}, **the system shall** append exactly one corresponding `run_logs` row whose `level` matches the explicit per-call level (info / warn / error), whose `stage` is `"collect"`, whose `source` is `"blog"`, whose `event` is the same event name string, and whose `context` jsonb preserves all structured fields the Pino emission already carries (`source`, `listingUrl`, `discovered`, `validated`, `afterSinceDays`, `capped`, `error`, etc.).

### REQ-002 — Crawler stats reach `run_logs`
**When** the web crawler completes a batch and emits `crawler.stats`, **the system shall** append one `run_logs` row at `level="info"`, `stage="collect"`, `source="blog"`, `event="crawler.stats"`, with `context` carrying the same fields the Pino line carries (jobs, requestsFinished, requestsFailed, requestsRetries, etc.). If `requestsFailed > 0`, the row's level is `"warn"` instead of `"info"`.

### REQ-003 — Link-enrichment failures appear as error-level rows
**When** `enrichRawItems` records a failure (cancelled, non-ok `enrichOne` result, or caught exception), **the system shall** append one `run_logs` row at `level="error"`, `stage="enrich"`, `source=<the item's sourceType>`, `event="link_enrichment.failed"`, `message` = `"link enrichment failed: <hostname> — <reason>"`, and `context` = `{ url, externalId, failureReason, originatingCollector }`.

### REQ-004 — Failure rows carry verbose context
**When** any collector emits a failure event in {`collector.web.discovery_failed`, `web.extract.failed`, `web.collect.failed`, `source.failed`, `link_enrichment.failed`}, **the system shall** include in the `context` jsonb the keys `url` (when a URL is the unit of failure), `error` (the error message string), and `step` (a short string identifying the failing step — e.g. `"discovery"`, `"extract"`, `"enrich"`, `"collect"`).

### REQ-005 — Source row identifier matches raw-item identifier (the dropdown fix)
**When** the web collector produces a `unitResults` entry for a source, **the system shall** set `unit.identifier` to the hostname-derived value produced by `deriveRawItemIdentifier({ sourceType: "blog", url: ps.source.listingUrl, ... })`, NOT the raw listing URL. The `unit.displayName` is unchanged (`ps.source.name`).

### REQ-006 — Source-items dropdown returns matching items
**Given** a run whose web collector ingested N>0 items from source S, **when** the operator opens the per-source items dropdown on `/admin/runs/:runId`, **the system shall** show N items (the dropdown body is no longer empty for an `itemsFetched>0` row).

### REQ-007 — Debug Timeline shows new rows within 2 s
**Given** an in-progress run, **when** the pipeline writes a new `run_logs` row, **the system shall** surface it in the page's Debug Timeline within one poll cycle (`POLL_INTERVAL_MS = 2000` in `useRunObservability.ts` — unchanged).

### REQ-008 — `run_logs` insert failure is non-fatal (unchanged invariant)
**When** an insert into `run_logs` from any of the above sites fails, **the system shall** log to stdout as `run_log.write_failed` and continue the run. The pipeline never aborts because a log row couldn't be written. (This is the existing contract in `createRunLogger`; new call sites must inherit it — i.e. they all go through `runLogger.<level>`, not direct repo inserts.)

### REQ-009 — Level mapping is explicit per call site
**When** a collector / crawler / enricher emits an event, **the system shall** route it through `runLogger.info`, `runLogger.warn`, or `runLogger.error` based on an explicit per-call decision documented at the call site, NOT derived from a Pino numeric level. Mandatory mapping:
- `collector.web.listing_completed`, `collector.web.discovery_completed`, `web.extract.start`, `web.extract.complete`, `web.enrichment.skip`, `web.enrichment.complete`, `collector.web.completed`, `crawler.stats` (no failures) → `info`
- `collector.web.discovery_failed`, `crawler.stats` (failures > 0) → `warn`
- `web.extract.failed`, `web.collect.failed`, `link_enrichment.failed` → `error`

### REQ-010 — No regression to existing observability shape
**The system shall not** change the shape of `RunObservability` (`run`, `funnel`, `sources`, `enrichment`, `stages`, `cost`, `logs`, `failures`, `live`) returned by `GET /api/admin/runs/:runId/observability`. The `failures` array is still `logs.filter(l => l.level === "error")`; it simply contains more rows now.

## Non-functional Requirements

- **No new external deps.** No schema migration.
- **TypeScript strict** — no `any`, no `as unknown as`.
- **Best-effort logging** — a throwing `run_logs` insert never fails a run (REQ-008).

## Architecture Touch-Points

- `packages/pipeline/src/services/run-logger.ts` — add `withPinoBridge(runLogger, baseLogger)` helper returning a `RunLogger` that also emits to the underlying Pino logger.
- `packages/pipeline/src/services/link-enrichment/types.ts` — add optional `runLogger` on `EnrichmentContext`.
- `packages/pipeline/src/services/link-enrichment/index.ts` — emit `link_enrichment.failed` rows on the three failure branches.
- `packages/pipeline/src/collectors/web.ts` — accept an optional `runLogger` arg (or thread through deps), wrap calls at the listed events, and **change `unit.identifier` derivation** (REQ-005).
- `packages/pipeline/src/services/web-crawler.ts` — accept an optional `runLogger`, emit `crawler.stats` row.
- `packages/pipeline/src/workers/run-process.ts` — at the point where it already owns `runLogger`, pass it into the web collector + enrichment context + web-crawler.
- `packages/shared/src/services/source-units.ts` (or wherever `deriveRawItemIdentifier` lives — explore agent says `@newsletter/shared/services`) — re-used unchanged.

## Verification Scenarios

### VS-1 — Unit: source identifier derivation parity
Construct a `unitResult` from `ps.source.listingUrl = "https://cursor.com/blog"` via the new web-collector code path. Construct a `raw_items` row for a post at `https://cursor.com/blog/some-post`. Compute `deriveRawItemIdentifier(item)`. **Expected:** `unit.identifier === deriveRawItemIdentifier(item)`. Repeat for at least 5 distinct listing URLs (canonical, subdomain `blog.example.com`, path-only listing, listing with trailing slash, listing on `.co.uk`).

### VS-2 — Unit: `withPinoBridge` double-emits
Mock a Pino `baseLogger` and a `RunLogRepo`. Call `wrapped.info({ stage: "collect", source: "blog", event: "x" }, "msg")`. **Expected:** `baseLogger.info` is called once AND `repo.append` is called once. Repeat for warn/error/debug.

### VS-3 — Unit: enrichment failure emits an error row
Build an `EnrichmentContext` with a mock `runLogger`. Force a fetch-exception path through `enrichRawItems`. **Expected:** `runLogger.error` is called exactly once with `event="link_enrichment.failed"`, `stage="enrich"`, `source=<item.sourceType>`, and `context.url === item.url`, `context.failureReason` non-empty. Repeat for cancelled and non-ok branches.

### VS-4 — Unit: enrichment success path emits NO error row
Build an `EnrichmentContext` with a mock `runLogger` and a successful enrichment. **Expected:** zero `runLogger.error` calls; zero `runLogger.warn` calls.

### VS-5 — Unit: level mapping for crawler stats
Call the web-crawler emit path with `requestsFailed = 0` → expect `runLogger.info`. Repeat with `requestsFailed > 0` → expect `runLogger.warn`. Repeat for the web-collector event level table in REQ-009.

### VS-6 — E2E (api): observability endpoint reflects new rows
Seed a `run_logs` table with one row per event in REQ-001/REQ-002/REQ-003 for a synthetic `runId`. Call `GET /api/admin/runs/:runId/observability`. **Expected:** the response `logs[]` includes every seeded row at the correct level; `failures[]` is the subset with `level="error"` and includes the link-enrichment row.

### VS-7 — E2E (api): source-items dropdown returns matching items after the fix
Seed a `run_archives` row with `sourceTelemetry.sources[0] = { sourceType: "blog", identifier: "cursor.com", itemsFetched: 3, ... }` and three matching `raw_items` rows whose URLs hostname-derive to `cursor.com`. Call `GET /api/admin/runs/:runId/sources/blog:cursor.com/items`. **Expected:** `items.length === 3`.

### VS-8 — E2E (api): legacy archive with listing-URL identifier still 200s (graceful empty)
Seed a `run_archives` row with the LEGACY `sourceTelemetry.sources[0].identifier = "https://cursor.com/blog"` (no migration done) and zero matching items by hostname. Call `GET /api/admin/runs/:runId/sources/blog:https%3A%2F%2Fcursor.com%2Fblog/items`. **Expected:** 200 with `items.length === 0` (no crash). The dropdown shows empty for legacy archives — accepted per design.

### VS-9 — UI proof (Playwright MCP): Debug Timeline shows new events in ALL mode (UI claim)
Open `/admin/runs/<runId>` for a run whose archive carries the seeded rows from VS-6. Filter = ALL. Screenshot. **Expected (visible in screenshot):** `collector.web.listing_completed`, `collector.web.discovery_failed`, `web.extract.start`, `crawler.stats`, `link_enrichment.failed` rows are rendered in the timeline, each with their correct level badge (info / warn / error). Open the Failure Cards section. Screenshot. **Expected:** the `link_enrichment.failed` row appears as a card with `url` and `failureReason` visible.

### VS-10 — UI proof (Playwright MCP): source-items dropdown opens to populated list (UI claim)
On the same `/admin/runs/<runId>` page, scroll to the per-source telemetry table. Click "Expand items" on the `blog · cursor.com` row. Screenshot. **Expected:** the modal/panel shows the three seeded items, not "No items collected for this source."

## Out of scope (re-stated)
- SSE / WebSocket push.
- Legacy archive backfill.
- Capturing Crawlee's internal autoscaled-pool memory warnings.
- Tightening the 2s poll interval.
- UI styling changes.

## Risk register

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | New error rows for routine enrichment failures noise up the Failure Cards | Acceptable per user request: they explicitly want enrichment failures visible. Operator can filter timeline to Warn-only if desired. |
| R2 | Identifier change in REQ-005 breaks anything that reads `sourceTelemetry.identifier` and expects a URL | Audited: no other reader expects URL form. The public `/sources` page derives independently. Source-facets route uses the persisted identifier verbatim — works either way. |
| R3 | `run_logs` insert throughput becomes a hotspot on large runs (60-120 inserts/run) | Best-effort insert with caught errors (existing pattern), append-only table with `(run_id, id)` index, rows ≤ ~1 KB each. Order of magnitude below problem size. |
