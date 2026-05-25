# SPEC: Newsletter date reflects scheduled publish date

**Source:** docs/spec/publishedat-newsletter-date/design.md
**Generated:** 2026-05-25

## Summary

The UI must display a newsletter issue's date as its **scheduled publish date** rather
than its pipeline-run date. A nullable `run_archives.published_at` (timestamptz) column is
added and populated at successful-run finalize using the existing `publishDateForWindow`
helper (publishTime = `emailTime`). All display surfaces (public listing date block +
month grouping, public archive detail issue date, admin dashboard rows, and list
ordering/issue-numbering) derive the date as `published_at` with a `completedAt` fallback
so pre-existing archives and unschedulable runs are unaffected.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The `run_archives` table shall have a nullable `published_at` timestamptz column. | Drizzle schema defines `published_at` as nullable timestamptz; migration `0031_*.sql` adds the column; `pnpm --filter @newsletter/shared db:generate` produces no further diff. | Must |
| REQ-002 | Event-driven | When a run finalizes successfully and user settings are present with `emailTime` ≠ `pipelineTime`, the system shall set `published_at` to `publishDateForWindow({timezone: scheduleTimezone, pipelineTime, publishTime: emailTime, completedAt})`. | Unit test: finalize with pipelineTime=23:00, emailTime=06:00, completedAt=23:30 local → `published_at` is next day 06:00 in the timezone. E2e: finalized run's row has non-null `published_at` equal to the computed value. | Must |
| REQ-003 | Unwanted | If user settings are absent at finalize, then the system shall leave `published_at` NULL. | Unit test: finalize with `settings = null` → upsert input `publishedAt` is undefined/null; row `published_at IS NULL`. | Must |
| REQ-004 | Unwanted | If `emailTime` equals `pipelineTime` at finalize, then the system shall leave `published_at` NULL without throwing. | Unit test: finalize with emailTime==pipelineTime → no throw, `publishedAt` null, archive row still written with all other fields intact. | Must |
| REQ-005 | Unwanted | If a run does not finalize successfully (failed or cancelled), then the system shall not set `published_at`. | Unit/e2e: failed-run archive write leaves `published_at` NULL. | Must |
| REQ-006 | Event-driven | When the API serializes an archive list item, the system shall set `runDate = formatDateInTimezone(published_at ?? completedAt, timezone)`. | Unit test on `toArchiveListItem`: row with `published_at` set → `runDate` uses it; row with `published_at` NULL → `runDate` uses `completedAt`. | Must |
| REQ-007 | Event-driven | When the API serializes a single archive (`GET /api/archives/:runId`), the system shall set `issueDate = formatDateInTimezone(published_at ?? startedAt ?? completedAt, timezone)`. | Unit test on `getIssueDate`: precedence `published_at` > `startedAt` > `completedAt`. | Must |
| REQ-008 | Event-driven | When the API lists reviewed archives (listing and no-query search), the system shall order rows by `COALESCE(published_at, completed_at) DESC`. | Integration test: a set with mixed `published_at`/NULL rows returns newest-effective-date first; an old NULL row sorts by its `completedAt`. | Must |
| REQ-009 | Ubiquitous | The public archive listing date block and month grouping shall display the effective publish date (the `runDate` returned by the API). | E2e (UI): listing row with a known `published_at` renders that date in the date block and groups under the publish-date month. | Must |
| REQ-010 | Ubiquitous | The public archive detail page shall display the effective publish date as its issue date. | E2e (UI): `/archive/:runId` for a run with `published_at` renders the publish date. | Must |
| REQ-011 | Ubiquitous | The admin dashboard run rows shall display the effective publish date. | E2e (UI): `/admin` row for a run with `published_at` shows the publish date. | Should |
| REQ-012 | Event-driven | When issue numbers are derived from list position, the system shall number issues consistently with the publish-date ordering from REQ-008. | E2e (UI): with a mixed set, the highest issue number is the row with the latest effective publish date. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `emailTime` == `pipelineTime` | `published_at` left NULL; `publishDateForWindow` not allowed to throw out of finalize; archive write succeeds. | REQ-004 |
| EDGE-002 | Run completes at 03:00 with emailTime 06:00, pipelineTime 23:00 | `published_at` = same local date 06:00? No — `publishMinutes(360) < pipelineMinutes(1380)` → helper adds one local day → next day 06:00. (Matches "next occurrence after a late-night run".) | REQ-002 |
| EDGE-003 | Archive created before this change (`published_at` NULL) | Listing/detail fall back to `completedAt` / `startedAt ?? completedAt`; sorts by `completedAt`. No visible regression. | REQ-006, REQ-007, REQ-008 |
| EDGE-004 | Settings present but `scheduleTimezone` missing/invalid | Use the helper's timezone input; if unusable, the guard leaves `published_at` NULL (no throw). | REQ-003, REQ-004 |
| EDGE-005 | Mixed list: some rows `published_at`, some NULL | Ordering and month-grouping use the same effective date so a row never appears under a mismatched month header. | REQ-008, REQ-009 |
| EDGE-006 | DST boundary day | `published_at` computed by the existing `publishDateForWindow` formatter-reconciliation loop (already DST-correct); not reimplemented. | REQ-002 |
| EDGE-007 | Dry-run archive | May carry `published_at` but is excluded from public listings already; no behavior change. | REQ-005 |
| EDGE-008 | `emailTime` malformed (not HH:MM) | Guard leaves `published_at` NULL without throwing (helper would throw on parse). | REQ-004 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Schema + migration diff check. |
| REQ-002 | Yes | Yes | Yes | No | Unit on finalize compute; e2e round-trip row. |
| REQ-003 | Yes | No | No | No | settings=null path. |
| REQ-004 | Yes | No | No | No | equal-times guard, no throw. |
| REQ-005 | Yes | Yes | No | No | failed/cancelled finalize leaves NULL. |
| REQ-006 | Yes | No | No | No | toArchiveListItem fallback. |
| REQ-007 | Yes | No | No | No | getIssueDate precedence. |
| REQ-008 | Yes | Yes | No | No | ORDER BY COALESCE; mixed set. |
| REQ-009 | No | No | Yes | No | Playwright: date block + month group. |
| REQ-010 | No | No | Yes | No | Playwright: detail issue date. |
| REQ-011 | No | No | Yes | No | Playwright: admin row date. |
| REQ-012 | No | No | Yes | No | Playwright: issue numbering follows publish order. |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | Yes | No | No | No | |
| EDGE-003 | Yes | Yes | Yes | No | NULL fallback unit + ordering + UI. |
| EDGE-004 | Yes | No | No | No | |
| EDGE-005 | Yes | No | Yes | No | coherence of ordering + grouping. |
| EDGE-006 | Yes | No | No | No | DST via existing helper (covered by its tests). |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | Yes | No | No | No | malformed emailTime guard. |

## Verification Scenarios (UI proof)

These map to `type: "ui"` claims that functional-verify must re-prove via Playwright MCP:

- **VS-1 (REQ-009):** Seed a reviewed archive whose `published_at` is a known date (e.g.
  2026-05-26) distinct from its `completed_at` (e.g. 2026-05-25). Load `/`. Assert the row's
  date block shows the **publish** date and the row is grouped under the publish month.
  Screenshot.
- **VS-2 (REQ-010):** Load `/archive/:runId` for that archive. Assert the issue date shown
  is the publish date. Screenshot.
- **VS-3 (REQ-011):** Load `/admin` (authenticated). Assert that run's row shows the
  publish date. Screenshot.
- **VS-4 (REQ-012 / EDGE-005):** Seed two reviewed archives — one with `published_at` =
  later date, one pre-change with `published_at` NULL (older `completed_at`). Load `/`.
  Assert ordering is newest-effective-date first and issue numbering is consistent (the
  publish-dated row outranks the older NULL row). Screenshot.

## Out of Scope

- **No historical backfill.** Existing archives keep `published_at` NULL and fall back to
  `completedAt`. No migration script computes publish dates for old rows.
- **No change to the actual send timestamps.** `emailSentAt`, `linkedinPostedAt`,
  `twitterPostedAt` are untouched; this feature uses the *scheduled* publish date, not the
  actual send moment.
- **No new env var, no new external dependency, no new npm package.**
- **No change to the scheduling/cron behavior** (`reconcilePipelineSchedule`, BullMQ
  repeatable jobs). Only a derived display date is stored.
- **No new admin settings field.** `emailTime`/`pipelineTime`/`scheduleTimezone` are reused
  as-is.
- **No editing of `published_at` from the review UI.** It is computed and stored by the
  pipeline only.
- **LinkedIn/Twitter publish times are not used** for the displayed date — `emailTime` is
  the canonical publish time.
