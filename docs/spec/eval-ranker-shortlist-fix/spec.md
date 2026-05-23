# SPEC: Eval ranker ranks the deduped collected pool, correlated by run_id

Design: `docs/spec/eval-ranker-shortlist-fix/design.md`
Library probe: `docs/spec/eval-ranker-shortlist-fix/library-probe.md` (NOT_APPLICABLE)

## Summary

Fix calendar-mode (Mode B) eval so it re-ranks the **deduplicated** set of items
collected during the selected run, attributing items to the run by a new
`raw_items.run_id` column (with a time-window fallback for pre-migration archives).
Today the eval ranks an un-deduplicated, time-window-approximated pool and reports
an inconsistent `itemCount`, which makes it look like only the already-ranked items
are available.

## Key code locations

- `packages/shared/src/db/schema.ts` — `rawItems` table (add `runId`).
- `packages/shared/migrations/` — generated Drizzle migration.
- `packages/pipeline/src/repositories/raw-items.ts` — `upsertItems` (carry `runId`).
- `packages/pipeline/src/workers/run-process.ts` — collect stage; `runId` in scope.
- `packages/pipeline/src/processors/dedup.ts` — `dedupCandidates(items)` returns survivors.
- `packages/pipeline/src/repositories/eval-exports.ts` — `getCompletedRunDetail`,
  `findRawItemsInWindow`, `listCompletedRunsByDate`, `buildPreviousRanking`.
- `packages/api/src/routes/admin-eval.ts` — `buildCalendarRunFixture`, calendar routes.
- `packages/web/src/pages/EvalIndexPage.tsx`, `packages/web/src/components/eval/CalendarReportComparison.tsx` — itemCount display.

## Requirements (EARS)

### REQ-001 — `raw_items.run_id` column
The system SHALL add a nullable `run_id uuid` column to `raw_items` with an index on
`run_id`. The column SHALL be nullable so existing rows and the add-post single-item
path (which has no run) remain valid.

### REQ-002 — Stamp `run_id` during collection
WHEN the run-process worker writes `raw_items` during a run's collect stage, the
system SHALL set `run_id` to the current `runId` on every inserted/updated row.
Because `raw_items` upserts on `ON CONFLICT (source_type, external_id) DO UPDATE`,
the system SHALL update `run_id` on conflict so it reflects the most recent run that
collected the item (a "last run that saw this item" pointer).

### REQ-003 — Add-post path unaffected
WHEN an item is added via the add-post single-item flow (no run context), the system
SHALL write `run_id = NULL` and SHALL NOT error.

### REQ-004 — Eval pool attribution by run_id
WHEN building the calendar-run detail for a run whose collected items carry a
`run_id`, the system SHALL load the candidate pool by `WHERE run_id = $runId`
(exact attribution), NOT by the `collectedAt` time window.

### REQ-005 — Time-window fallback for legacy runs
WHEN building the calendar-run detail for a run that has **no** `raw_items` with a
matching `run_id` (pre-migration archive), the system SHALL fall back to the existing
`collectedAt BETWEEN [startedAt ?? createdAt, completedAt]` window so historical runs
still load (no regression).

### REQ-006 — Dedup the eval pool at eval time
WHEN constructing the `sourcePool` for a calendar run, the system SHALL apply the
existing `dedupCandidates` processor to the loaded items and expose the **surviving
(deduped)** items as the pool the eval ranks from. Duplicates removed by dedup SHALL
be absent from the pool.

### REQ-007 — Eval ranks the deduped pool, not the ranked subset
WHEN a draft prompt is run against a selected calendar run, the ranker SHALL receive
the deduped candidate pool (REQ-006) as its candidate set — not `run_archives.rankedItems`
and not the raw un-deduped pool.

### REQ-008 — `previousRanking` still resolves against the pool
The system SHALL continue to render `previousRanking` (the original `rankedItems`)
joined against the (now deduped) pool. WHERE a previously-ranked item is not present
in the deduped pool (e.g. it was a dedup loser, or its `run_id` differs), the system
SHALL still render that previous-ranking row using the stored `RankedItemRef` fields
(`title`/`score`/etc.) so the comparison view is not broken.

### REQ-009 — Consistent itemCount
The `itemCount` reported by `listCompletedRunsByDate` (calendar list) and by
`getCompletedRunDetail` (loaded detail) SHALL report the **same meaning**: the size
of the deduped candidate pool the eval will rank from. The two values SHALL be equal
for a given run.

### REQ-010 — No behaviour change to the live ranking pipeline
The collect → dedup → shortlist → rank pipeline SHALL produce the same ranked output
as before for a given input (the only change to the live path is stamping `run_id`).

## Edge cases

- **EDGE-001:** Two runs on the same calendar day. With `run_id`, the second run's
  pool MUST NOT include the first run's items (except items genuinely re-collected by
  the second run, which legitimately carry the second run's `run_id`).
- **EDGE-002:** A run with zero collected items / empty deduped pool — the calendar
  detail SHALL report `itemCount: 0`; the `POST /run` ab path already throws
  "run source pool empty" (422) and SHALL continue to.
- **EDGE-003:** Pre-migration archive (no `run_id` items) — falls back to the window
  and is deduped (REGRESSION GUARD: still loads, now deduped).
- **EDGE-004:** An item re-collected by a later run (its `run_id` moved forward).
  Loading the earlier run by `run_id` will not return it; this is accepted — the eval
  reflects the most-recent collection's attribution.
- **EDGE-005:** `previousRanking` item absent from the deduped pool (REQ-008) — row
  still renders from `RankedItemRef`.

## Verification Scenarios

### VS-1 (unit, REQ-006/007) — dedup applied to eval pool
Given a pool with two items sharing a canonical URL (one higher engagement), when the
eval pool is built, then only the higher-engagement survivor is in `sourcePool` and
the ranker candidate list excludes the duplicate.

### VS-2 (unit, REQ-004/005) — attribution by run_id with fallback
Given raw_items tagged with `run_id = R`, `getCompletedRunDetail(R)` loads exactly
those items. Given an archive whose items have `run_id = NULL`, it falls back to the
time window and still returns a non-empty deduped pool.

### VS-3 (unit, REQ-009) — itemCount equality
For a given run, `listCompletedRunsByDate` and `getCompletedRunDetail` return the same
`itemCount` (= deduped pool size).

### VS-4 (unit, REQ-002/003) — run_id stamping
`upsertItems` writes the provided `runId` on each row; called without a runId (add-post
path) writes `NULL`. On conflict, `run_id` is updated to the latest run.

### VS-5 (e2e, REQ-001/002/004/006/007) — full calendar re-rank
Against live DB+Redis: run a real run-process job (stamps run_id, dedups, ranks),
then call `getCompletedRunDetail(runId)` and assert the pool equals the deduped
collected set for that run_id, is larger than `rankedItems`, and excludes a seeded
duplicate. Then drive `POST /api/admin/eval/run` (ab mode) and assert the draft
ranking can include a pool item that was NOT in the original `rankedItems`.

### VS-6 (ui, REQ-009) — calendar list + detail itemCount match
Via Playwright on `/admin/eval`: select a date, observe the run row's item count,
load the run detail, and confirm the displayed candidate-pool count matches and that
the comparison view shows pool items beyond the original ranked set.

## Out of scope
- Persisting dedup clusters or the shortlist.
- Backfilling `run_id` on historical raw_items.
- Changes to Mode A scored-fixture pool construction beyond shared dedup code paths.
