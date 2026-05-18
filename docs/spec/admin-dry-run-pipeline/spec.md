# Spec: Admin Dry-Run Pipeline

**Source design:** `docs/plans/2026-05-18-admin-dry-run-design.md`
**Date:** 2026-05-18

## Summary

Admin can trigger a "dry run" of the newsletter pipeline that executes
collection → enrichment → ranking → recap → archive identically to a live run
but suppresses subscriber email delivery, LinkedIn auto-post, and X
(Twitter) auto-post. Dry-run archives are persisted with an `is_dry_run` flag,
remain fully visible inside `/admin`, and are excluded from every public
listing or per-archive surface.

## Functional Requirements (EARS)

### Trigger surface

- **R-1.** WHEN the admin sends `POST /api/runs/now` with body `{ "dryRun": true }`, THEN the API SHALL start a run whose `RunProcessJobPayload` carries `dryRun: true` and respond `202 { runId }`.
- **R-2.** WHEN the admin sends `POST /api/runs/now` with no body, an empty body, or a body where `dryRun` is omitted or `false`, THEN the API SHALL start a live run (`dryRun: false`) — preserving the pre-existing contract.
- **R-3.** WHEN the admin clicks **Run now** on `/admin`, THEN the dashboard SHALL render a dropdown with two items: *Run now* (primary, live) and *Run now (dry run)* (secondary, dry-run). Each item SHALL be disabled when a run is already active (current `runNowDisabled` semantics preserved).

### Persistence

- **R-4.** WHEN a run with `dryRun = true` completes (status `completed`, `failed`, or `cancelled`), THEN the inserted `run_archives` row SHALL have `is_dry_run = true`.
- **R-5.** WHEN a run with `dryRun = false` completes, THEN the inserted `run_archives` row SHALL have `is_dry_run = false`.
- **R-6.** All existing `run_archives` rows present before the migration SHALL have `is_dry_run = false` after migration.

### Publish suppression

- **R-7.** WHEN `reconcilePerArchiveJobs` is invoked with an archive whose `isDryRun = true`, THEN it SHALL return `{ removed: [], enqueued: [] }` without calling `queue.add` or `queue.remove` for any of `email-send`, `linkedin-post`, `twitter-post`, AND SHALL emit a log line `event: "publish.skipped_dry_run"` containing the `runId`.
- **R-8.** WHEN the admin reviews a dry-run archive via `PATCH /api/admin/archives/:runId`, THEN no `email-send`, `linkedin-post`, or `twitter-post` job SHALL be enqueued as a result of the review-completion path.
- **R-9.** WHEN settings change triggers `reconcilePerArchiveJobs` for a dry-run archive, THEN no publish job SHALL be enqueued or removed.
- **R-10.** WHEN an `email-send`, `linkedin-post`, or `twitter-post` worker handler receives a job whose archive has `isDryRun = true`, THEN the handler SHALL return without invoking the external client (Resend / LinkedIn API / Twitter API) AND SHALL emit a log line `event: "publish.dry_run_bypassed"` with `runId` and `channel`. (Defensive guard against bypassed scheduler.)
- **R-11.** WHEN a dry-run archive transitions to `reviewed = true`, THEN no Slack review-completion notification SHALL be posted.

### Public visibility

- **R-12.** WHEN any client calls `GET /api/archives`, THEN the response SHALL exclude archives where `is_dry_run = true`.
- **R-13.** WHEN any client calls `GET /api/archives/search` (with or without `q`, `from`, `to` params), THEN the response SHALL exclude archives where `is_dry_run = true` from both the `archives` array and the `total` count.
- **R-14.** WHEN any client calls `GET /api/archives/:runId` for an archive where `is_dry_run = true`, THEN the API SHALL respond `404 { error: "not found" }`, regardless of auth state. (404, not 403 — avoids leaking existence.)
- **R-15.** WHEN the admin dashboard renders a recent-runs row whose archive has `isDryRun = true`, THEN the row SHALL display a visible **DRY RUN** badge.
- **R-16.** WHEN the admin opens `/admin/review/:runId` for a dry-run archive, THEN the review header SHALL display a visible **DRY RUN** pill.
- **R-17.** Admin routes (`GET /api/runs`, `GET /api/admin/runs/:runId/sources`, `PATCH /api/admin/archives/:runId`, etc.) SHALL continue to include and operate on dry-run archives — visibility filtering applies only to public routes.

### Scope guards

- **R-18.** Scheduled daily runs (BullMQ `daily-run` repeatable job) SHALL always run in live mode (`dryRun = false`) regardless of any future settings — the dry-run toggle is admin-triggered only.
- **R-19.** `userSettings` SHALL NOT gain a `defaultDryRun` column in this iteration.

## Edge Cases

| # | Case | Expected behavior |
|---|------|-------------------|
| E-1 | `POST /api/runs/now` with `{ "dryRun": "true" }` (string, not boolean) | Zod validation rejects: `400 { error: "..." }` |
| E-2 | `POST /api/runs/now` with `{ "dryRun": 1 }` (number) | Zod validation rejects: `400` |
| E-3 | Dry-run is cancelled mid-run (`POST /api/runs/:runId/cancel`) | `run_archives` row is written with `status: "cancelled"`, `is_dry_run: true`. No publish jobs were ever enqueued (status never reached completed → review). |
| E-4 | Two dry-runs created back-to-back, both reviewed | Each is persisted independently; neither triggers any publish job; neither appears in public listing. |
| E-5 | A worker dispatches `email-send` for a live archive that *has* been re-tagged dry-run after-the-fact (hypothetical bug) | Defensive worker guard (R-10) catches it: returns without sending, logs `publish.dry_run_bypassed`. |
| E-6 | `GET /api/archives/search?q=<term>` where the matching archive is dry-run | Excluded from both result set and `total`. |
| E-7 | An archive exists with `reviewed = false` AND `is_dry_run = true` | Neither admin review-warning timers nor public listing surface it (public requires `reviewed = true`; review-warning timers gated by R-9). |
| E-8 | Migration runs on a DB with existing reviewed archives | All existing rows get `is_dry_run = false`; public listing behavior unchanged. |

## Verification Scenarios

These are derived from the design doc's Verification section and must all pass before the feature ships. Each scenario maps to one or more EARS requirements above.

### VS-1: Live run unchanged (R-2, R-5, R-7-inverse)

- **Setup:** Fresh worktree, infra up (`pnpm infra:up`), settings configured with at least one source.
- **Action:** `curl -X POST http://localhost:3000/api/runs/now -H "Cookie: admin_session=…"`.
- **Expected:**
  - `202 { runId }`.
  - After run completes, `SELECT is_dry_run FROM run_archives WHERE id = :runId` → `false`.
  - After review (PATCH archive), BullMQ `processing` queue contains delayed jobs `email-send-:runId`, `linkedin-post-:runId`, `twitter-post-:runId` exactly as today (or whichever are enabled).

### VS-2: Dry-run end-to-end (R-1, R-4, R-7)

- **Setup:** Same as VS-1.
- **Action:** `curl -X POST http://localhost:3000/api/runs/now -d '{"dryRun":true}' -H "Content-Type: application/json"`.
- **Expected:**
  - `202 { runId }`.
  - After run completes, `SELECT is_dry_run FROM run_archives WHERE id = :runId` → `true`.
  - BullMQ `processing` queue contains **no** `email-send-:runId`, `linkedin-post-:runId`, or `twitter-post-:runId` jobs.
  - Logs contain `event: "publish.skipped_dry_run"` with this `runId`.

### VS-3: Public listing excludes dry-runs (R-12, R-13)

- **Setup:** Two reviewed archives in DB — one live, one dry-run.
- **Action:** `curl http://localhost:3000/api/archives` and `curl 'http://localhost:3000/api/archives/search?q=test'`.
- **Expected:** Live archive present, dry-run archive absent in both responses. `searchReviewed.total` reflects only the live row.

### VS-4: Public per-archive 404 (R-14)

- **Setup:** Reviewed dry-run archive in DB.
- **Action:** `curl -i http://localhost:3000/api/archives/<dry-run-id>` (no admin cookie).
- **Expected:** `404 { "error": "not found" }`.

### VS-5: Admin still sees dry-runs (R-17, R-15)

- **Setup:** Same as VS-3.
- **Action:** Admin loads `/admin`.
- **Expected:**
  - `GET /api/runs?limit=30` returns both archives.
  - Dashboard renders a "DRY RUN" badge on the dry-run row (Playwright check).

### VS-6: Review of dry-run does not publish (R-8, R-11)

- **Setup:** Completed dry-run archive, not yet reviewed.
- **Action:** `PATCH /api/admin/archives/<dry-run-id>` with valid reorder body.
- **Expected:**
  - `200`.
  - `reviewed = true` in DB.
  - No publish jobs enqueued.
  - No Slack webhook POST (verify via mock).

### VS-7: Defensive worker guard (R-10)

- **Setup:** Reviewed dry-run archive in DB.
- **Action:** Programmatically add a job `{ name: "email-send", data: { runId } }` to the processing queue (simulating bypass).
- **Expected:** Worker logs `event: "publish.dry_run_bypassed"`, no Resend / LinkedIn / Twitter API call is made (verify via mock client).

### VS-8: Dashboard UX (R-3)

- **Setup:** Web dev server running.
- **Action:** Playwright: load `/admin`, click "Run now" dropdown chevron.
- **Expected:**
  - Two menu items visible: "Run now" and "Run now (dry run)".
  - Clicking "Run now (dry run)" issues `POST /api/runs/now` with body `{ "dryRun": true }`.
  - Clicking "Run now" issues `POST /api/runs/now` with no body (or `{ "dryRun": false }`).
  - Both items respect `runNowDisabled` state.

## Out of scope

- A persistent default-dry-run flag in `userSettings`.
- Promoting a dry-run archive to a live publish.
- Adding `is_dry_run` to PostHog event properties.
- Backfilling historical archives.
