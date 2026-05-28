# Run Telemetry — Live Logs, Verbose Failures, Items Dropdown Fix

**Date:** 2026-05-28
**Spec dir:** `docs/spec/run-telemetry-live-logs/`
**Linear:** (none — operator-quality of life)

## Problem

The per-run observability page (`/admin/runs/:runId`) has three concrete defects that block an operator from understanding what happened in a run:

1. **Web-collector logs are invisible in the Debug Timeline.** Pino events emitted by `collector:web` and `crawler:web` (e.g. `collector.web.listing_completed`, `collector.web.discovery_failed`, `web.extract.start`, `crawler.stats`) only reach stdout — they never land in `run_logs`. The Debug Timeline (which reads exclusively from `run_logs`) shows the run as a black box between the `stage.start` and `stage.end` rows.
2. **The per-source items dropdown is empty even when the source row shows N items fetched.** A web-collector source row reports `itemsFetched=10`, but expanding the dropdown shows "No items collected for this source." Root cause is a key mismatch:
   - The source row's `identifier` is set to `ps.source.listingUrl` (e.g. `https://cursor.com/blog`) in `web.ts::503-510`.
   - Each raw_item's `sourceIdentifier` is derived at read time via `deriveRawItemIdentifier(item)` → the URL hostname (e.g. `cursor.com`).
   - The dropdown filter in `run-source-items.ts::84-88` requires `item.sourceIdentifier === parsedSource.identifier`, so the hostname-vs-listing-URL mismatch always returns zero items.
3. **Link-enrichment failures don't appear in the Failures section.** `enrichRawItems` bumps `counters.failed` silently on every failed enrichment — no `RunLogger.error` / `.warn` call is made. So 18 enrichment failures produce zero `run_logs` rows with `level="error"`, and the Failure Cards section renders empty. The user can see "18 failed" in the EnrichmentStrip but cannot find a single error row explaining which URL failed and why.

Plus a related polish requirement: stdout-level Crawlee + warn-level memory-pressure events (`AdaptivePlaywrightCrawler: Memory is critically overloaded`) should be categorised correctly when they enter `run_logs` (info / warn / error), not all dumped as a single level.

## External Dependencies & Fallback Chain

**No new external libraries.** Every change is internal: route existing Pino emissions through the existing `RunLogger`, emit new `run_logs` rows on existing failure paths, and fix a key derivation. No probe needed.

## Approach

The observability page already polls every 2s and stops on terminal status. "Live streaming" is satisfied by the existing 2s poll *iff* the events we want to see are actually written to `run_logs` as they happen. So the work is **not** an SSE/WebSocket layer — it's making sure the right events land in `run_logs` synchronously with the pipeline emitting them. The page picks them up on its next 2s tick.

### Change 1 — Stream collector / crawler logs into `run_logs`

The pipeline's collectors currently use a module-scoped Pino logger via `createLogger("collector:web")`. They never see a `RunLogger`. The minimal fix is to **thread the `RunLogger` instance** that the `run-process` worker already owns down into the collectors that emit interesting events (web + crawler), and have those collectors emit milestone events through both Pino (unchanged) AND `runLogger.<level>` (new) so they reach `run_logs`.

To avoid plumbing a `RunLogger` argument through every helper, we add a small adapter:

```ts
// packages/pipeline/src/services/run-logger.ts
export function withPinoBridge(runLogger: RunLogger, baseLogger: Logger): RunLogger
```

It returns a `RunLogger` that, on each call, ALSO calls `baseLogger.<level>(fields, msg)` — so existing pino consumers still see stdout. (The reverse — wrapping Pino so every line writes a `run_logs` row — is rejected because we don't want every Crawlee debug line in the DB; we only want milestones.)

Concretely, the web collector currently emits ~10 distinct events per source (`collector.web.listing_completed`, `collector.web.discovery_failed`, `collector.web.discovery_completed`, `web.extract.start`, `web.extract.complete`, `web.extract.failed`, `web.enrichment.skip`, `web.enrichment.complete`, `web.collect.failed`, `collector.web.completed`). These are exactly the events the Debug Timeline should show. We route them through `runLogger.<level>` at the call sites — one line each.

The crawler emits its own `crawler.stats` (one row per crawl) — that becomes one `run_logs` row at level info.

**Crawlee's internal logs** (`AdaptivePlaywrightCrawler: Memory is critically overloaded`) come from Crawlee's own logger and are not under our control by default. We won't try to capture every Crawlee internal log — that's noise. The valuable signal is `crawler.stats` at the end of each crawl and any `requestsFailed > 0` flagged as warn. That's already emitted by `web-crawler.ts` and just needs to be routed through `runLogger`.

**Level mapping rule.** Every event we route through `runLogger` carries an explicit level — `info`, `warn`, or `error`. The mapping is per-call, not derived from Pino's numeric level, so the operator sees `collector.web.discovery_failed` at warn (not all info because Pino emitted it at 40) and `web.collect.failed` at error.

### Change 2 — Align source-row identifier with item-row identifier

`buildSourceTelemetry` in `services/source-telemetry.ts::39-49` takes `unit.identifier` as-is. The web collector hands it `ps.source.listingUrl`. The simplest fix is at the **emit** site: in `web.ts::503-510`, derive the unit identifier with the **same function** that the item-side uses (`deriveRawItemIdentifier`) so the source row and the raw_items align by construction.

`deriveRawItemIdentifier` for `sourceType: "blog"` produces the URL hostname (e.g. `cursor.com`). We change `unitResults[i].identifier` to that derived hostname (computed once from `ps.source.listingUrl`). The `displayName` stays as `ps.source.name` so the operator still sees "Cursor" in the table label — only the matching key changes.

This is a behaviour change in the persisted `sourceTelemetry.identifier` on new runs. Legacy archives (where the row was persisted with `https://cursor.com/blog`) will continue to mismatch — but the user's question is about the live run, not historical, and we don't backfill. The `parseSourceKey` route helper already handles legacy `web_search:web_search:` prefixes (lines 137-141) so future legacy fallbacks have a precedent if needed.

### Change 3 — Emit per-failure `run_logs` rows from `enrichRawItems`

`enrichRawItems` currently has three failure-counter sites (cancelled, `result.status !== "ok"`, catch-block exception) and zero log calls. We add an injected `runLogger` on `EnrichmentContext` (already optional via `ctx.logger`) and emit one `run_logs` row per failure with `level="error"`, `stage="enrich"`, `event="link_enrichment.failed"`, `source=<sourceType>` (taken from `item.sourceType`), and a verbose context: `{ url: item.url, externalId: item.externalId, failureReason, originatingCollector: item.sourceType }`. The `message` line is `"link enrichment failed: <hostname> — <reason>"`.

This makes the 18 failures visible in both the Debug Timeline (filter to Error) and the Failure Cards (which already subsets `level=error`). The verbose context gives the operator exactly the URL + reason needed to triage.

The level choice (`error` vs `warn`) is `error` because the user explicitly asked for Failure-section visibility and Failure Cards filter `level=error`. We accept that a successful run with sparse enrichment failures will surface a few error rows — that's the desired UX.

### Change 4 — Verbose error context across collector + crawler failure paths

The user's broader ask is "make failure logs verbose: which step, which collector, which link." The existing `source.failed` and `run.failed` rows already carry stage + source; we extend collector emissions on the error side to consistently include the **URL** in `context.url` (for any URL-scoped failure) and the **upstream cause** in `context.error`. The Failure Card UI already renders `context` as a key/value strip — so just populating `url`/`error`/`step` consistently is enough; no UI change.

Concretely the events `collector.web.discovery_failed`, `web.extract.failed`, `web.collect.failed`, and the new `link_enrichment.failed` all carry `{ url, error, step }` in context. The Failure Card renders them inline.

### Change 5 — No new poll cadence

The user requirement "logs must be streamed live" is satisfied by the existing 2-second react-query poll in `useRunObservability.ts`. Once a log row is in `run_logs`, the next poll surfaces it. We **do not** add SSE/WebSocket — that's a far bigger change for the same end-user effect (≤2s perceived latency).

## Trade-offs

- **Pro:** All four issues fixed by routing existing emissions through the existing `RunLogger`. No schema migration, no new API route, no new dependencies, no new infra.
- **Con:** `run_logs` row count per run grows from ~20 to ~60-120 (one row per source/crawl/enrichment-failure event). The table is append-only with `(run_id, id)` index and rows are tiny — well under the size that would matter. We accept this.
- **Con (Change 2):** Source identifier on new runs is a hostname; legacy archives keep the listing-URL identifier and will continue to show empty dropdowns. This is acceptable per the same "no backfill" precedent used by published_at and recap.title.

## Out of Scope

- SSE / WebSocket push for logs.
- Backfilling legacy archives' `sourceTelemetry.identifier` to hostnames.
- Capturing Crawlee's internal autoscaled-pool memory warnings (they are interesting but not actionable; the `crawler.stats` row at end of crawl captures the actionable summary).
- Reducing the 2-second poll interval (already fast enough; faster polling burns DB unnecessarily).
- Changing the Debug Timeline UI itself (already supports All/Info/Warn/Error filter; just receives more rows).

## Non-Negotiables (verification gates)

1. After a run with at least one `blog` source, the source row's `identifier` matches what `deriveRawItemIdentifier` produces for any item from that source — i.e. the dropdown opens to a populated list, not "No items collected".
2. After a run with at least one link-enrichment failure, the Failure Cards section on `/admin/runs/:runId` lists that failure with `url` and `failureReason` visible.
3. The Debug Timeline (filter = ALL) shows `collector.web.listing_completed`, `collector.web.discovery_failed`, `web.extract.start`, `web.extract.complete`, `crawler.stats`, and `link_enrichment.failed` rows for a run that exercised those paths — each at the correct level (info/warn/error).
4. No regression to `pnpm typecheck` or `pnpm lint`.
5. Existing e2e suite for observability + source-items routes still passes.
