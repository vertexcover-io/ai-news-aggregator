# SPEC: Run Observability Page

**Source:** docs/spec/run-observability-page/design.md
**Generated:** 2026-05-25
**Frontend mock (approved):** docs/spec/run-observability-page/mocks/run-observability.html

## Overview

A centralized, per-run observability page at `/admin/runs/:runId` that surfaces
detailed debug logs, stage funnel counts, per-source telemetry, link-enrichment
stats, per-stage timing & cost, and full-context failure logs. Viewable **live**
(~2s refresh) while a run is in progress and **persisted** for any past run via a
new append-only `run_logs` table and a `run_archives.run_funnel` column. One
server-side composition endpoint returns a single typed payload for both live
and historical runs.

## Requirements

### Data model & persistence

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall define a `run_logs` table in `@newsletter/shared` with columns `id bigserial PK`, `run_id uuid` (indexed), `created_at timestamptz`, `level text`, `stage text`, `source text NULL`, `event text`, `message text`, `context jsonb NULL`. | Drizzle migration generates and applies cleanly; `\d run_logs` shows all columns and a `run_id` index. | Must |
| REQ-002 | Ubiquitous | The system shall add a nullable `run_funnel jsonb` column to `run_archives` holding `{ collected, deduped, shortlisted, ranked }` (each `number \| null`). | Migration applies; column is nullable; legacy rows read as `null`. | Must |
| REQ-003 | Ubiquitous | The system shall expose a `RunLogEntry` type and a `RunObservability` payload type from `@newsletter/shared/types`. | Types importable via subpath; `RunObservability` contains `run`, `funnel`, `sources`, `enrichment`, `stages`, `cost`, `logs`, `failures`, `live`. | Must |

### Pipeline log emission

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Ubiquitous | The pipeline shall provide a `runLogger(runId)` helper that, for each call, inserts a `run_logs` row AND emits the corresponding existing Pino line. | Calling `runLogger(runId).info({event,...}, msg)` inserts exactly one row and logs to stdout. | Must |
| REQ-011 | Event-driven | When a run starts and ends each stage (collecting, processing, shortlisting, ranking, finalize), the pipeline shall emit `stage.start` and `stage.end` `run_logs` entries, the `stage.end` carrying `context.durationMs`. | After a run, `run_logs` contains paired `stage.start`/`stage.end` rows for every stage reached; each `stage.end` row has numeric `context.durationMs`. | Must |
| REQ-012 | Event-driven | When a source unit completes or fails during collection, the pipeline shall emit a `source.completed` or `source.failed` `run_logs` entry carrying `source`, `context.itemsFetched`, `context.durationMs`, and (on failure) `context.errors`. | After a run with a failing source, `run_logs` has one `source.failed` row for it with non-empty `context.errors`, and `source.completed` rows for the others. | Must |
| REQ-013 | Event-driven | When the dedup, shortlist, and rank stages produce counts, the pipeline shall emit `stage.result` `run_logs` entries carrying `context.inputCount` and `context.outputCount`. | `run_logs` contains `stage.result` rows for dedup (input/output), shortlist (input/output), rank (input/output) after a completed run. | Must |
| REQ-014 | Event-driven | When link enrichment finishes for a run, the pipeline shall emit one `enrichment.summary` `run_logs` entry carrying the `EnrichmentTelemetry` snapshot in `context`. | A completed run with enrichment has exactly one `enrichment.summary` row whose context has `attempted/ok/failed/skipped/cacheHits`. | Must |
| REQ-015 | Event-driven | When the pipeline finalizes a run, it shall persist the funnel counts (`collected/deduped/shortlisted/ranked`) into `run_archives.run_funnel`. | After a completed run, `run_archives.run_funnel` is non-null with the four integer counts matching the `stage.result` log rows. | Must |
| REQ-016 | Unwanted | If inserting a `run_logs` row throws, then the system shall catch the error, log it to stdout, and continue the run without failing. | Injecting a failing repo insert in a test does not abort the run; the run still reaches a terminal status; an error is logged. | Must |
| REQ-017 | Unwanted | If a fatal error aborts a run at any stage, then the pipeline shall emit a `run.failed` `run_logs` entry at `level="error"` carrying `message`, `context.stage`, `context.source` (if applicable), and `context.stack` when the error is an `Error`. | A run forced to fail mid-stage has a `level="error"` `run.failed` row with a non-empty `context.stack`. | Must |

### API composition endpoint

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Event-driven | When an authenticated admin GETs `/api/admin/runs/:runId/observability`, the system shall return a `200` with a `RunObservability` payload. | Authenticated request returns 200 and a body matching the `RunObservability` shape. | Must |
| REQ-021 | State-driven | While a run is non-terminal and has a Redis run-state, the endpoint shall set `live=true` and source the per-source counters, current stage, and in-progress funnel/cost from live state + `run_logs`. | For an in-flight run, the payload has `live=true`, `funnel` reflecting stages reached so far, and `logs` present even though no `run_archives` row exists yet. | Must |
| REQ-022 | State-driven | While a run is terminal (or its Redis state has expired), the endpoint shall set `live=false` and source `funnel`, `sources`, `enrichment`, and `cost` from `run_archives` plus `run_logs`. | For a completed run with no Redis key, the payload has `live=false` and fully populated `sources`/`funnel`/`cost` from the archive. | Must |
| REQ-023 | Ubiquitous | The endpoint shall derive `failures` as the subset of `logs` where `level === "error"`. | `failures` length equals the count of `level="error"` log rows for the run. | Must |
| REQ-024 | Unwanted | If `:runId` matches no run-state and no `run_archives` row, then the endpoint shall return `404`. | GET with a random UUID returns 404. | Must |
| REQ-025 | Unwanted | If the request is unauthenticated, then the endpoint shall return `401`/redirect per the existing `requireAdmin` gate (cost data never served unauthenticated). | Unauthenticated GET is rejected by `requireAdmin`; no payload body is returned. | Must |
| REQ-026 | Ubiquitous | The endpoint shall return `logs` ordered by insertion order (`run_logs.id` ascending). | Returned `logs` array is monotonically non-decreasing by `id`. | Must |

### Frontend page

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Ubiquitous | The web app shall render a `RunObservabilityPage` at route `/admin/runs/:runId` behind the admin gate. | Navigating to `/admin/runs/:id` while authenticated renders the page; unauthenticated redirects to `/admin/login`. | Must |
| REQ-031 | Ubiquitous | The dashboard shall link each run row to its observability page. | Each run row exposes a control that navigates to `/admin/runs/:runId`. | Must |
| REQ-032 | State-driven | While the viewed run is non-terminal, the page shall poll the observability endpoint every ~2s and stop polling on terminal status. | react-query refetches on a ~2s interval for a running run and ceases refetch once status is completed/failed/cancelled. | Must |
| REQ-033 | Ubiquitous | The page shall render all six approved sections: masthead+status, pipeline funnel, stage timing+cost, source telemetry table, enrichment strip, failures, and debug timeline. | All six sections render for a run with full data, matching the approved mock's hierarchy. | Must |
| REQ-034 | State-driven | While a run is live, the masthead shall show a pulsing live status pill with `status · stage` and the funnel shall render not-yet-reached stages as pending. | Live run shows the live pill and a pending bar for unreached funnel stages. | Must |
| REQ-035 | Event-driven | When a log entry has `level="error"`, the timeline shall render it in the error style and allow expanding its stack/context. | An error log row renders distinctly and exposes the stack when context has one. | Must |
| REQ-036 | Event-driven | When the user selects a timeline level filter (All/Info/Warn/Error), the timeline shall show only entries at that level (All shows everything). | Selecting "Error" shows only `level="error"` rows; "All" restores the full list. | Should |
| REQ-037 | Unwanted | If a run has no `run_logs` entries (legacy run), then the timeline shall render an empty state and the page shall still render any available `sourceTelemetry`/`costBreakdown` from the archive. | A legacy archive (no logs) renders the empty-state timeline and still shows source/cost sections. | Must |
| REQ-038 | Unwanted | If a run has no failures, then the Failures section shall render an empty state. | A clean run shows the "no failures" empty state. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Observability requested for an in-flight run before the `run_archives` row exists | Endpoint composes from Redis run-state + `run_logs`; returns `live=true`; no 404. | REQ-021, EDGE-derived from REQ-022 |
| EDGE-002 | Run crashes mid-stage (fatal error) | `run_logs` rows written before the crash persist; a `run.failed` error row with stack is present; funnel shows counts up to the last completed stage, later stages null. | REQ-016, REQ-017, REQ-015 |
| EDGE-003 | Completed run whose Redis run-state has TTL-expired | Endpoint falls back to `run_archives` + `run_logs`; `live=false`; no live polling on the client. | REQ-022, REQ-032 |
| EDGE-004 | Dry-run | Logs/telemetry render identically, labeled dry-run; funnel and sources populate normally. | REQ-033 |
| EDGE-005 | Legacy archive created before this feature (no `run_logs`, `run_funnel=null`) | Timeline empty state; funnel cells show "—"; source/cost sections still render from archive. | REQ-037, REQ-002 |
| EDGE-006 | Concurrent collectors writing `source.*` rows simultaneously | All rows persist; timeline ordering by `id` interleaves them deterministically; no lost rows. | REQ-012, REQ-026 |
| EDGE-007 | Very long error message / stack string | Stored fully in `context`; UI truncates with expand-to-full; no layout break. | REQ-017, REQ-035 |
| EDGE-008 | `run_logs` insert fails transiently during a busy run | Error caught + stdout-logged; run unaffected; subsequent inserts still attempted. | REQ-016 |
| EDGE-009 | Source completes with 0 items but no error (empty source) | `source.completed` row with `itemsFetched=0`, status completed; table shows 0, no error note. | REQ-012, REQ-033 |
| EDGE-010 | Enrichment disabled / no URLs to enrich | No `enrichment.summary` row OR a row with all-zero counts; enrichment strip shows zeros, no crash. | REQ-014, REQ-033 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | No | No | Migration applied; verify via DB introspection in e2e. |
| REQ-002 | Yes | Yes | No | No | Nullable column; legacy null read. |
| REQ-003 | Yes | No | No | No | Type-level + import-shape test. |
| REQ-010 | Yes | Yes | No | No | runLogger writes 1 row + 1 Pino line. |
| REQ-011 | Yes | Yes | No | No | Paired stage.start/end with durationMs. |
| REQ-012 | Yes | Yes | No | No | source.completed/failed shape. |
| REQ-013 | Yes | Yes | No | No | stage.result funnel counts. |
| REQ-014 | Yes | Yes | No | No | enrichment.summary snapshot. |
| REQ-015 | Yes | Yes | No | No | run_funnel persisted at finalize. |
| REQ-016 | Yes | No | No | No | Failing insert does not abort run. |
| REQ-017 | Yes | Yes | No | No | run.failed error row with stack. |
| REQ-020 | Yes | Yes | Yes | No | Endpoint 200 + payload shape; E2E via page. |
| REQ-021 | Yes | Yes | Yes | No | live=true composition for in-flight run. |
| REQ-022 | Yes | Yes | Yes | No | live=false from archive. |
| REQ-023 | Yes | No | No | No | failures = level=error subset. |
| REQ-024 | Yes | Yes | No | No | 404 for unknown runId. |
| REQ-025 | Yes | Yes | No | No | requireAdmin gate. |
| REQ-026 | Yes | No | No | No | logs ordered by id. |
| REQ-030 | No | No | Yes | Yes | Route renders behind gate (UI). |
| REQ-031 | Yes | No | Yes | Yes | Dashboard link → page (UI). |
| REQ-032 | Yes | No | Yes | No | 2s poll, stop on terminal. |
| REQ-033 | Yes | No | Yes | Yes | All six sections render (UI). |
| REQ-034 | Yes | No | Yes | Yes | Live pill + pending funnel (UI). |
| REQ-035 | Yes | No | Yes | No | Error row + stack expand (UI). |
| REQ-036 | Yes | No | No | No | Level filter. |
| REQ-037 | Yes | No | Yes | Yes | Legacy empty state (UI). |
| REQ-038 | Yes | No | No | No | No-failures empty state. |
| EDGE-001 | Yes | Yes | No | No | |
| EDGE-002 | Yes | Yes | No | No | |
| EDGE-003 | Yes | Yes | No | No | |
| EDGE-004 | Yes | No | No | No | |
| EDGE-005 | Yes | No | Yes | Yes | Legacy run UI. |
| EDGE-006 | Yes | No | No | No | |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | Yes | No | No | No | |
| EDGE-009 | Yes | No | No | No | |
| EDGE-010 | Yes | No | No | No | |

## Verification Scenarios

No external-dependency probe scenarios (library-probe verdict: NOT_APPLICABLE —
pure-internal feature). Functional verification will drive the live UI:

- **VS-1 (UI, live run):** With infra up, trigger a run; open `/admin/runs/:runId`
  while it is running; observe the live pill, the funnel populating across stages,
  the source table updating, and the timeline appending entries within ~2s; confirm
  polling stops at terminal status. Capture screenshots.
- **VS-2 (UI, historical run):** Open `/admin/runs/:runId` for a completed run;
  confirm `live=false`, all six sections render from persisted data, and failures
  (if any) show full context. Capture screenshot.
- **VS-3 (UI, failure):** For a run with a failing source (e.g. unconfigured
  Twitter cookies), confirm the Failures section and the error-styled timeline row
  with expandable stack render. Capture screenshot.
- **VS-4 (UI, legacy/empty):** Open a run with no `run_logs`; confirm timeline and
  failures empty states render while source/cost sections still populate.

## Out of Scope

- **Per-item logging** — each enriched URL / each fetched item is NOT persisted to
  `run_logs`; that detail stays in `raw_items.metadata`. Only milestone events.
- **Real-time streaming (SSE/WebSocket)** — live updates use the existing 2s
  react-query polling, not a push channel.
- **Log retention / cleanup jobs** — logs are kept forever; no scheduled deletion.
- **Public access** — the page is admin-only; no public observability surface.
- **Editing / re-running from the page** — the observability page is read-only;
  existing run controls (cancel/retry/delete) remain on the dashboard.
- **Cross-run analytics / source health trends over time** — that is the existing
  `/sources` page's job; this page is single-run scoped.
- **Backfilling logs for historical runs** — legacy runs simply show empty-state
  timelines; we do not reconstruct logs for runs that predate this feature.
- **Changing the live mechanism for the existing review/dashboard polling** — we
  add a new endpoint/hook; `useRunPolling` is untouched.
