# SPEC: Persistent Settings, Daily Scheduling, and Dashboard (Phase 1)

**Source:** [`../2026-04-14-ui-overhaul-settings-review-design.md`](../2026-04-14-ui-overhaul-settings-review-design.md)
**Generated:** 2026-04-14
**Mockups:** [`dashboard.png`](../2026-04-14-ui-overhaul-mockups/dashboard.png) · [`settings.png`](../2026-04-14-ui-overhaul-mockups/settings.png)

This is Phase 1 of the UI overhaul. It replaces the manual `/run` form with a persistent, singleton-row settings model; introduces a BullMQ repeatable scheduler that fires the existing pipeline once per day at the user-chosen time; and surfaces past runs through a new Dashboard landing page. Review/curation is a separate SPEC.

---

## Requirements

### Data model

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall persist exactly one row of user settings in a `user_settings` table. | A unique index on `singleton` (boolean, default true) rejects any insert that would produce a second row. | Must |
| REQ-002 | Ubiquitous | The `user_settings` row shall contain: `profileName` (text, nullable), `topN` (int), `halfLifeHours` (int, nullable), `hnConfig` (jsonb, nullable), `redditConfig` (jsonb, nullable), `webConfig` (jsonb, nullable), `scheduleTime` (text HH:MM), `scheduleTimezone` (text IANA), `scheduleEnabled` (boolean), `updatedAt` (timestamptz). | `pnpm --filter @newsletter/shared db:generate` produces a Drizzle migration with exactly these columns; `db:migrate` applies cleanly. | Must |
| REQ-003 | Ubiquitous | The `run_archives` table shall have a `reviewed` boolean column, NOT NULL, default `false`. | Drizzle migration adds the column; backfill migration sets `reviewed = true` for all pre-existing rows. | Must |
| REQ-004 | Event-driven | When the settings migration runs against an existing database, the system shall set `reviewed = true` on every existing `run_archives` row in the same migration. | After migration, `SELECT COUNT(*) FROM run_archives WHERE reviewed = false` returns 0 for all rows whose `createdAt < migration_time`. | Must |

### Settings API

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Event-driven | When the frontend requests `GET /api/settings`, the system shall return the current settings row as JSON, or `null` if no row exists. | Response body matches the shared TS type `UserSettings \| null`; status 200 on both cases. | Must |
| REQ-011 | Event-driven | When the frontend requests `PUT /api/settings` with a valid body, the system shall upsert the singleton row and return the persisted row. | Zod schema validates the body; on success, response status 200 and body equals the row as returned by `GET /api/settings`. | Must |
| REQ-012 | Unwanted | If `PUT /api/settings` receives a body that fails zod validation, then the system shall return HTTP 400 with an error payload listing the offending fields. | Response status 400; body has `{ error: string, issues: ZodIssue[] }` shape. | Must |
| REQ-013 | Unwanted | If `PUT /api/settings` receives settings with `scheduleEnabled: true` but no source config enabled, then the system shall return HTTP 400. | Response status 400 with error message mentioning "at least one source must be enabled". | Must |
| REQ-014 | Event-driven | When `PUT /api/settings` succeeds, the system shall reconcile the BullMQ `daily-run` repeatable job in the same request. | On return, the repeatable key `daily-run:default` exists in BullMQ if `scheduleEnabled` is true with a cron matching `scheduleTime` + `scheduleTimezone`; otherwise no such key exists. | Must |
| REQ-015 | Ubiquitous | The shared TypeScript `UserSettings` type shall be defined in `@newsletter/shared` and imported by both the API validator and the frontend. | `packages/shared/src/types/settings.ts` exports `UserSettings`; API and web both import from `@newsletter/shared`. | Must |

### Scheduling

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Ubiquitous | The system shall register at most one BullMQ repeatable job with key `daily-run:default` at any time. | `QueueScheduler.getRepeatableJobs()` returns zero or one entry with that key; never two. | Must |
| REQ-021 | Event-driven | When settings are saved with `scheduleEnabled: true`, the system shall remove any existing `daily-run:default` repeatable before adding a new one with the computed cron and timezone. | Integration test: save settings twice with different times; queue contains exactly one repeatable and its cron matches the most recent save. | Must |
| REQ-022 | Event-driven | When settings are saved with `scheduleEnabled: false`, the system shall remove the `daily-run:default` repeatable if it exists. | After save, `getRepeatableJobs()` does not contain an entry for that key. | Must |
| REQ-023 | Ubiquitous | The scheduler shall use BullMQ's `tz` repeat option with the value of `scheduleTimezone` so the cron fires in the user's timezone including across DST transitions. | Unit test with a known `tz` (e.g. `America/New_York`) and time (`09:30`) asserts next fire time computes to the correct UTC instant on either side of a DST boundary. | Must |
| REQ-024 | Event-driven | When the `daily-run` repeatable fires, the pipeline processor shall read the current `user_settings` row and enqueue a `run-process` job with a freshly generated `runId`. | After trigger, a new row appears in Redis with key `run:<runId>` and a BullMQ job with `name: "run-process"` is added to the `processing` queue. | Must |
| REQ-025 | Unwanted | If the `daily-run` processor fires but `user_settings` is missing or has no sources enabled, then the system shall log a warning and exit without enqueueing. | Log line at level `warn` with message `daily-run skipped: <reason>`; no new `run:*` key in Redis. | Must |

### Run-start service

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Ubiquitous | The system shall expose a single `startRun(settings)` service function used by both `POST /api/runs/now` and the `daily-run` processor to begin a run. | Grep for `queue.add("run-process"` returns exactly one site — the body of `startRun`. | Must |
| REQ-031 | Event-driven | When `POST /api/runs/now` is called, the system shall load the current `user_settings`, call `startRun`, and return `{ runId }` with status 202. | Response body is `{ runId: string }` where `runId` is a UUID v4; status 202. | Must |
| REQ-032 | Unwanted | If `POST /api/runs/now` is called while `user_settings` is null, then the system shall return HTTP 409 with a message instructing the user to configure settings first. | Response status 409; body `{ error: "settings not configured" }`. | Must |

### Dashboard API

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Event-driven | When the frontend requests `GET /api/runs`, the system shall return an array of recent run summaries sorted by `startedAt` DESC. | Response status 200; body is `{ runs: RunSummary[] }` where each entry has `{ runId, startedAt, completedAt, status, itemCount, reviewed }`. | Must |
| REQ-041 | Ubiquitous | `GET /api/runs` shall return active (Redis-only, in-progress) runs merged with completed runs from `run_archives`. | Integration test: start a run, immediately call `GET /api/runs`, the new `runId` appears with `status: "running"`; after completion, the same call shows `status: "completed"` and is read from `run_archives`. | Must |
| REQ-042 | Ubiquitous | `GET /api/runs` shall accept an optional `?limit=N` query parameter (integer 1-100, default 30). | Response array length is min(available, limit); values outside 1-100 return HTTP 400. | Should |

### Dashboard UI

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Ubiquitous | The system shall render `/` as the Dashboard page, replacing the prior `/` → `/run` redirect. | Navigating to `/` renders a page with the heading "Recent runs"; no redirect occurs. | Must |
| REQ-051 | Event-driven | When the dashboard loads, the system shall call `GET /api/runs` and render each run as a table row showing date, a status badge, item count, and an action button. | For status `ready-to-review`: button labeled "Review"; `reviewed`: "View archive"; `failed`: "Retry"; `running`: "Open". | Must |
| REQ-052 | State-driven | While any run has `status: "running"`, the system shall poll `GET /api/runs` every 2 seconds. | React Query's `refetchInterval` is `2000` when at least one run is in a non-terminal state, otherwise `false`. | Must |
| REQ-053 | Event-driven | When the user clicks the "Run now" button, the system shall call `POST /api/runs/now`, disable the button until the current run reaches a terminal state, and show an inline toast on failure. | Button `disabled` attribute toggles with active run presence; 4xx response surfaces a toast whose message comes from the response body. | Must |
| REQ-054 | Ubiquitous | The dashboard header shall include a "Settings" link that navigates to `/settings`. | Clicking the link updates the URL to `/settings` via react-router. | Must |
| REQ-055 | State-driven | While `user_settings` is `null`, the dashboard shall render an empty state with a "Configure your newsletter" call-to-action that links to `/settings`. | If `GET /api/settings` returns `null`, the runs table is replaced with a centered empty state containing the exact CTA text "Configure your newsletter". | Must |
| REQ-056 | Ubiquitous | The dashboard shall render a schedule banner showing the next scheduled run time whenever `user_settings.scheduleEnabled` is true. | Banner text has the form "Scheduled to run daily at HH:MM <tz>. Next run in <relative-time>."; banner is absent when disabled. | Should |

### Settings UI

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Ubiquitous | The system shall render a Settings page at `/settings` with three sections: Profile & ranking, Sources, Schedule. | Page heading is "Settings"; three `<section>` or `<fieldset>` elements with these labels are present in the DOM. | Must |
| REQ-061 | Ubiquitous | The Profile & ranking section shall expose form inputs for `profileName` (select), `topN` (number), `halfLifeHours` (number). | Each input is labeled, keyboard-focusable, and bound to the react-hook-form register. | Must |
| REQ-062 | Ubiquitous | The Sources section shall show one row per source (HN, Reddit, Web) with a toggle switch, a plain-text configuration summary, and an Edit action that opens the per-source config form. | Each source row has an `aria-label` matching its name; toggle state is two-way bound to `<source>Config !== null`. | Must |
| REQ-063 | Ubiquitous | The Schedule section shall expose a time picker (HH:MM), a timezone select populated from `Intl.supportedValuesOf('timeZone')`, and a master enabled toggle. | Time input accepts values in `HH:MM` 24-hour format; timezone select contains at least "UTC" and "Asia/Kolkata". | Must |
| REQ-064 | Event-driven | When the user clicks "Save changes", the system shall PUT the form contents to `/api/settings` and show a success toast on 200 or an error toast on 4xx. | Toast contains the response body's error message on failure; toast contains "Settings saved" on success. | Must |
| REQ-065 | Ubiquitous | The Settings page header shall include a "Back to dashboard" link that navigates to `/`. | Link text is exactly "Back to dashboard"; clicking updates the URL to `/`. | Must |
| REQ-066 | Event-driven | When the user clicks "Run now" inside the Settings page footer, the system shall call `POST /api/runs/now` and navigate to `/` on success. | On 202 response, URL changes to `/`; on 4xx, user stays on `/settings` and sees an error toast. | Should |
| REQ-067 | Event-driven | When the user visits `/run` (the legacy route), the system shall redirect to `/settings`. | `GET /run` in the SPA router emits a `<Navigate to="/settings" replace />` element. | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `PUT /api/settings` called concurrently from two tabs. | Last write wins; the repeatable job reconciliation still results in exactly one entry with the most recent cron. | REQ-014, REQ-020 |
| EDGE-002 | Settings saved with `scheduleTime` crossing DST spring-forward (e.g. 02:30 America/New_York). | BullMQ `tz` option handles it: the job fires at either the skipped hour's nearest valid equivalent or the next valid instant, without error. | REQ-023 |
| EDGE-003 | Server restart while a repeatable job exists in Redis. | On next `PUT /api/settings`, reconciliation removes the stale entry and adds a fresh one. | REQ-020, REQ-021 |
| EDGE-004 | User submits settings with an invalid IANA timezone string (e.g. "GMT+5"). | Zod validation rejects the value; HTTP 400 with issue pointing to `scheduleTimezone`. | REQ-012 |
| EDGE-005 | Daily run fires while a prior day's run is still running. | New run is enqueued with a different `runId`; both appear in `GET /api/runs`; neither is blocked. | REQ-024, REQ-041 |
| EDGE-006 | Database has zero `run_archives` rows when dashboard first loads. | Dashboard renders the runs table with an empty-table message "No runs yet" in place of rows (settings may or may not exist). | REQ-051, REQ-055 |
| EDGE-007 | `GET /api/runs` called with `?limit=0`. | HTTP 400 with message about valid range 1-100. | REQ-042 |
| EDGE-008 | User clicks "Run now" twice in rapid succession before the first response returns. | Second click is a no-op because the button is disabled after the first click's pending state; only one `POST /api/runs/now` request fires. | REQ-053 |
| EDGE-009 | Backfill migration runs on a DB that already has a `reviewed` column (e.g. migration rerun). | Migration is idempotent; re-running does not error. | REQ-003, REQ-004 |
| EDGE-010 | Daily-run processor fires while the repeatable job is being reconciled (race). | The processor reads settings at fire time; worst case it runs with old settings. Acceptable — no data corruption, at most one extra/missed run during the reconciliation window. | REQ-021, REQ-024 |
| EDGE-011 | `POST /api/runs/now` called while settings exist but all source toggles are disabled. | HTTP 409 with message "no sources enabled"; no run is enqueued. | REQ-032 |
| EDGE-012 | Browser timezone differs from the configured `scheduleTimezone`. | The settings form still saves the configured tz; the banner shows the next-run time in the configured tz, not the browser tz. | REQ-056 |

---

## Verification Matrix

| REQ/EDGE ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|-------------|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | No | No | Integration test attempts two inserts, asserts second fails with unique-violation |
| REQ-002 | Yes | No | No | No | Drizzle schema test |
| REQ-003 | No | Yes | No | No | Integration: run migration on fresh DB, check column exists |
| REQ-004 | No | Yes | No | No | Integration: seed archives, run migration, assert `reviewed=true` everywhere |
| REQ-010 | Yes | Yes | No | No | |
| REQ-011 | Yes | Yes | No | No | |
| REQ-012 | Yes | No | No | No | |
| REQ-013 | Yes | No | No | No | |
| REQ-014 | No | Yes | No | No | Uses BullMQ test harness to inspect repeatable jobs |
| REQ-015 | Yes | No | No | No | Type-level test: `z.infer<typeof schema> satisfies UserSettings` |
| REQ-020 | No | Yes | No | No | |
| REQ-021 | No | Yes | No | No | |
| REQ-022 | No | Yes | No | No | |
| REQ-023 | Yes | No | No | Yes | Unit test with fake clock; manual verify across a real DST boundary |
| REQ-024 | No | Yes | No | No | Trigger repeatable manually via test helper |
| REQ-025 | Yes | No | No | No | |
| REQ-030 | Yes | No | No | No | Grep assertion in a lint-like test |
| REQ-031 | Yes | Yes | No | No | |
| REQ-032 | Yes | No | No | No | |
| REQ-040 | Yes | Yes | No | No | |
| REQ-041 | No | Yes | No | No | Start run → immediately list → check "running" → await completion → list → check "completed" |
| REQ-042 | Yes | No | No | No | |
| REQ-050 | Yes | No | Yes | No | E2E: render `/`, assert heading |
| REQ-051 | Yes | No | Yes | No | |
| REQ-052 | Yes | No | No | No | Mock React Query's `refetchInterval` path |
| REQ-053 | Yes | No | Yes | No | |
| REQ-054 | Yes | No | No | No | |
| REQ-055 | Yes | No | Yes | No | |
| REQ-056 | Yes | No | No | Yes | Manual: visual check of banner wording |
| REQ-060 | Yes | No | No | No | |
| REQ-061 | Yes | No | No | No | |
| REQ-062 | Yes | No | No | No | |
| REQ-063 | Yes | No | No | No | |
| REQ-064 | Yes | No | Yes | No | E2E: fill form → save → assert toast |
| REQ-065 | Yes | No | No | No | |
| REQ-066 | Yes | No | No | No | |
| REQ-067 | Yes | No | No | No | |
| EDGE-001 | No | Yes | No | No | |
| EDGE-002 | Yes | No | No | Yes | |
| EDGE-003 | No | Yes | No | No | Restart test harness mid-run |
| EDGE-004 | Yes | No | No | No | |
| EDGE-005 | No | Yes | No | No | |
| EDGE-006 | Yes | No | No | No | |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | Yes | No | No | No | |
| EDGE-009 | No | Yes | No | No | Run migration twice in same test |
| EDGE-010 | No | No | No | Yes | Acceptable-by-design; document, don't test |
| EDGE-011 | Yes | No | No | No | |
| EDGE-012 | No | No | No | Yes | Visual check |

---

## Out of Scope

- **Review / curation UI** — handled in the Phase 2 SPEC (`review-curation/SPEC.md`). The dashboard's "Review" CTA in Phase 1 routes directly to `/archive/:runId` until Phase 2 ships.
- **Email delivery (Resend) and the "publish" action** — not wired in either phase.
- **Changes to the archive page (`/archive/:runId`)** — the archive UI is frozen for this overhaul.
- **Multiple named settings profiles / multi-config** — one singleton row only.
- **Authentication, user management, multi-user support** — internal single-user tool continues.
- **Retention policies on `run_archives`** — runs are kept indefinitely; no auto-delete.
- **Cron-expression input** — only HH:MM + IANA timezone is exposed; no raw cron.
- **Per-run overrides from the dashboard** — to change what runs, the user edits Settings.
- **Retry UX beyond a button** — "Retry" simply triggers a new `POST /api/runs/now`; no partial-resume of failed collectors.
- **Background health checks / cron-job monitoring endpoint** — out of scope.
- **Migration rollback scripts** — forward-only migrations; rollback is manual per project convention.
