# SPEC: Configurable Per-Task Schedules

**Source:** `docs/plans/2026-05-18-configurable-schedules-design.md`
**Library probe:** `docs/spec/configurable-schedule-settings/library-probe.md` (PASS — no new deps)
**Generated:** 2026-05-18
**Linear:** VER-TBD

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The system shall store four independent HH:MM schedule fields in `user_settings`: `pipelineTime`, `emailTime`, `linkedinTime`, `twitterTime`. | Drizzle migration adds the four `text NOT NULL` columns; `GET /api/settings` returns all four; settings repo upsert persists all four. | Must |
| REQ-002 | Ubiquitous | The system shall store a single `scheduleTimezone` field shared by all four schedule times. | Existing `scheduleTimezone` column is preserved and applied to every schedule computation. | Must |
| REQ-003 | Ubiquitous | The system shall store an `autoReview` boolean in `user_settings`, replacing the `AUTO_REVIEW` env var as runtime source of truth. | `user_settings.autoReview boolean NOT NULL DEFAULT false`; `run-process.ts` reads `settings.autoReview`, not `process.env.AUTO_REVIEW`. Env is used only on initial singleton seed. | Must |
| REQ-004 | Ubiquitous | The system shall store per-channel `enabled` booleans: `emailEnabled`, `linkedinEnabled`, `twitterEnabled`. | Migration adds three boolean columns defaulting to `true`. Returned by GET, persisted by PUT. | Must |
| REQ-005 | Event-driven | When `PUT /api/settings` is called with any publish time equal to `pipelineTime`, the system shall reject the request with HTTP 400 and an error object that names the offending field(s). Publish times earlier than `pipelineTime` are valid and mean next local day. | Response body matches `{ error: "...", fields: ["emailTime"] }` (or whichever fields equal `pipelineTime`). No DB write occurs. | Must |
| REQ-006 | Event-driven | When `PUT /api/settings` succeeds, the system shall reconcile the `pipeline-run:default` BullMQ scheduler to fire at `pipelineTime` in `scheduleTimezone`. | `Queue.upsertJobScheduler('pipeline-run:default', { pattern: '<m> <h> * * *', tz })` is called exactly once. If `scheduleEnabled=false`, the scheduler is removed. | Must |
| REQ-007 | Event-driven | When `PUT /api/settings` succeeds, the system shall reschedule all still-pending per-archive publish jobs (`email-send:<runId>`, `linkedin-post:<runId>`, `twitter-post:<runId>`, `review-warning:<runId>`) for run_archives where the corresponding channel timestamp is null. | For each affected runId × channel, the existing delayed job is removed by deterministic jobId and re-added with the new computed delay. Already-fired jobs are not touched. | Must |
| REQ-008 | Event-driven | When `handleRunProcessJob` writes a `run_archive` row with `status='completed'`, the system shall enqueue one-time delayed BullMQ jobs for each enabled publish channel and (when `autoReview=false`) a `review-warning` job. | For each of `email-send`, `linkedin-post`, `twitter-post`: enqueue only when `<channel>Enabled=true`; jobId is `<channel>:<runId>`; payload `{ runId }`; delay is `(target wall-clock in TZ) - now`, clamped to `0`. Publish times earlier than `pipelineTime` target the next local day after `run_archives.completedAt`; later times target the same local day. `review-warning` enqueued only when `autoReview=false`, at `min(enabled publish targets) - 5 min`. | Must |
| REQ-009 | State-driven | While `autoReview=false` and the pipeline writes a `run_archive` with `status='completed'`, the system shall post a Slack **review-pending** message linking to `/admin/review/:runId`. | Single Slack POST issued; on success, `run_archives.notificationState.reviewPending` is set to the ISO timestamp. Posting failures are logged but never thrown. | Must |
| REQ-010 | Event-driven | When the `review-warning:<runId>` job fires, the system shall check `run_archives.reviewed`. If `false`, post a Slack **review-warning** message naming the earliest publish channel and time. | Slack POST issued; on success, `notificationState.reviewWarning` is set. If `reviewed=true`, the handler exits without posting. Idempotent: a second invocation with `notificationState.reviewWarning != null` is a no-op. | Must |
| REQ-011 | Event-driven | When an `email-send:<runId>` / `linkedin-post:<runId>` / `twitter-post:<runId>` job fires AND the linked `run_archive.reviewed` is `true` AND the corresponding `<channel>PostedAt` is null, the system shall execute the publish action and set `<channel>PostedAt` on success. | Email handler delivers to subscribers and posts the existing Slack send-summary; LinkedIn handler posts via existing notifier; Twitter handler posts via existing notifier. Idempotent: handler is a no-op when `<channel>PostedAt` is already set. | Must |
| REQ-012 | Unwanted | If an `email-send:<runId>` / `linkedin-post:<runId>` / `twitter-post:<runId>` job fires AND `run_archives.reviewed` is `false`, then the system shall post a Slack **publish-failed** message ("Email/LinkedIn/Twitter was not posted — newsletter not reviewed in time") and exit without publishing. | Slack POST issued; on success, `notificationState.<channel>Failure` is set. Idempotent: second invocation with the marker set is a no-op. `<channel>PostedAt` remains null. | Must |
| REQ-013 | Ubiquitous | The system shall store all five Slack-notification idempotency markers in a single `notificationState` jsonb column on `run_archives`. | Schema: `notificationState jsonb` with shape `{ reviewPending, reviewWarning, emailFailure, linkedinFailure, twitterFailure }` (each ISO string or null). Migration adds the column nullable; existing rows default to `null` (treated as all-null). | Must |
| REQ-014 | Ubiquitous | The system shall compute "today at HH:MM in IANA timezone → epoch ms" using a zero-dependency `Intl.DateTimeFormat`-based helper. | Helper round-trips correctly for at least these timezones: `UTC`, `America/New_York`, `Europe/London`, `Asia/Kolkata`. No new npm dependency added. | Must |
| REQ-015 | Event-driven | When the `pipeline-run:default` job fires while `scheduleEnabled=true`, the system shall enqueue a `run-process` job using the current settings. | Behavior parity with current `handleDailyRunJob`: load settings, short-circuit if no sources enabled, otherwise call `startRun`. Only the scheduler-key name changes (`daily-run:default` → `pipeline-run:default`). | Must |
| REQ-016 | Ubiquitous | The system shall replace the `newsletter-send` BullMQ job and its handler with three new job names: `email-send`, `linkedin-post`, `twitter-post`. | `processing.ts` dispatch table contains three new branches and no `newsletter-send` branch. Old worker file is removed. The Slack send-summary call moves into `email-send`. | Must |
| REQ-017 | Ubiquitous | The system shall expose the four schedule times, the per-channel `enabled` flags, and the `autoReview` flag in the admin Settings UI. | `SettingsPage` renders four labeled HH:MM inputs, three Enabled toggles, and one Auto-review toggle. Client-side validation blocks Save when a publish time equals `pipelineTime` and shows per-field error text. | Must |
| REQ-018 | Event-driven | When the API process boots, the system shall remove the legacy `daily-run:default` scheduler if it exists and ensure `pipeline-run:default` is reconciled from current settings. | A bootstrap function calls `Queue.removeJobScheduler('daily-run:default')` once, then `reconcilePipelineSchedule(settings)`. Idempotent across reboots. | Must |
| REQ-019 | Unwanted | If `Queue.remove(jobId)` is called for a jobId that does not exist (job already fired or never enqueued), then the system shall treat the call as a successful no-op and continue. | No exception propagates from reconcilePerArchiveJobs; a debug log records `notFound`. | Should |
| REQ-020 | Unwanted | If posting to Slack fails (network/HTTP error) for any of the five notification types, then the system shall log the error at `warn` level and not throw. | The underlying job/handler/request completes normally. The corresponding `notificationState` field remains `null` so a retry path can re-attempt. | Must |
| REQ-021 | State-driven | While `scheduleEnabled=false`, the system shall not enqueue any per-archive publish or warning jobs even if a `run_archive` is written. | When `scheduleEnabled=false`, `reconcilePerArchiveJobs` removes any pending jobs and skips enqueue. The pipeline scheduler is already disabled per existing behavior. | Must |
| REQ-022 | Event-driven | When `PATCH /api/admin/archives/:runId` marks an archive as reviewed, the system shall ensure the per-archive publish/warning jobs exist (creating any missing) but shall not change their fire times. | `reconcilePerArchiveJobs(runId, settings)` is invoked; for each channel, if no pending job exists and `<channel>PostedAt` is null and `<channel>Enabled`, the job is enqueued with delay = (target − now, clamped to 0). | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Pipeline finishes after a publish time has already passed today (e.g. pipeline `09:00`, email `09:05`, archive written at `09:06`). | Email job is still enqueued with `delay=0`; BullMQ fires it immediately; if `reviewed=false`, REQ-012 (publish-failed Slack) applies. | REQ-008, REQ-012 |
| EDGE-002 | Pipeline runs twice the same day (manual `POST /api/runs/now` after the daily). | Each archive carries its own `runId`; each gets its own set of per-archive jobs (distinct deterministic jobIds). Both fire. The reviewed archive publishes; the other emits publish-failed notifications. | REQ-008 |
| EDGE-003 | Admin saves settings with `emailTime=08:00, pipelineTime=08:00` (equal). | REQ-005 rejects with 400 naming `emailTime`. No DB write, no reconciliation. | REQ-005 |
| EDGE-004 | Admin changes `emailTime` from `09:00` to `10:00` after the pipeline already wrote the archive but before email-send fires. | REQ-007 reschedules: removes `email-send:<runId>` (delay 3h) and re-adds at the new wall-clock target. Other channels untouched. | REQ-007 |
| EDGE-005 | Admin changes settings during the 5-minute window between `review-warning` enqueue and its scheduled fire time. | The pending `review-warning` job is removed and re-enqueued for the new earliest-publish time minus 5 min. If the new time has passed, delay=0 and it fires immediately; idempotency via `notificationState.reviewWarning` ensures it only posts once. | REQ-007, REQ-010 |
| EDGE-006 | `linkedinEnabled` flips from `true` to `false` after the per-archive `linkedin-post:<runId>` job was already enqueued. | REQ-007's reconciliation removes the pending job by deterministic jobId. No publish, no failure notification, no posting timestamp. | REQ-007, REQ-021 |
| EDGE-007 | `linkedinEnabled` flips from `false` to `true` after the pipeline ran (no job was enqueued initially). | On settings PUT, reconcilePerArchiveJobs sees `<channel>PostedAt` is null and `<channel>Enabled=true` and no pending job exists; it enqueues the job with the now-current `linkedinTime`. | REQ-007, REQ-022 |
| EDGE-008 | DST transition between pipeline run and a publish time (rare for half-hour offsets; relevant for US Spring-forward). | The TZ helper computes the wall-clock-to-UTC mapping using `Intl.DateTimeFormat` against the *now* timestamp, which already reflects DST status. Job fires at the wall-clock time configured. | REQ-014 |
| EDGE-009 | All three `*Enabled` flags are `false` and `autoReview=false`. | Pipeline still runs; archive is written; `review-warning` is NOT enqueued (no enabled publish channels to warn about); review-pending Slack is still posted. No publish jobs fire. | REQ-008, REQ-009 |
| EDGE-010 | Slack webhook URL is unset. | All five new notification types (review-pending, review-warning, email-failure, linkedin-failure, twitter-failure) become no-ops; no idempotency markers are set; no error is thrown. | REQ-020 |
| EDGE-011 | A still-pending `email-send:<runId>` job exists when admin saves settings with `scheduleEnabled=false`. | REQ-021 + REQ-007: the pending job is removed; future archive writes don't enqueue replacements. Returning `scheduleEnabled=true` later re-enqueues per current settings for any not-yet-published archive. | REQ-007, REQ-021 |
| EDGE-012 | Pipeline writes archive with `status='failed'` or `status='cancelled'`. | No publish/warning jobs are enqueued. No review-pending Slack is posted. | REQ-008, REQ-009 |
| EDGE-013 | `review-warning` fires while `autoReview=true` (race: setting flipped between archive write and warning fire). | Handler reads current settings; if `autoReview=true`, exits without posting. | REQ-010 |
| EDGE-014 | `Queue.remove(jobId)` is called for a job that already fired (timestamp passed). | REQ-019: treated as no-op. Reconciliation continues. The already-fired handler completes normally. | REQ-019 |
| EDGE-015 | `<channel>Enabled=true` in settings but the channel's notifier env vars are unset (e.g. `linkedinEnabled=true` but no `LINKEDIN_CLIENT_ID`). | Existing notifier behavior is preserved: the publish handler logs and skips. `<channel>PostedAt` is not set, but no Slack failure-notification is posted (this is a configuration error, not a review failure). | REQ-011 |
| EDGE-016 | Admin saves `pipelineTime=19:00` and `emailTime=09:00`. | REQ-005 accepts the settings. A completed archive from day X schedules email for day X+1 at 09:00 in `scheduleTimezone`; `review-warning` uses that next-day target. | REQ-005, REQ-008 |

## Verification Matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-001 | Yes | Yes | No | No | Drizzle migration test + repo upsert/get round-trip. |
| REQ-002 | Yes | No | No | No | Covered by REQ-014 helper tests. |
| REQ-003 | Yes | Yes | No | No | Unit: handler reads settings.autoReview. Integration: env-var fallback path. |
| REQ-004 | Yes | Yes | No | No | Repo round-trip + UI rendering. |
| REQ-005 | Yes | Yes | No | No | Zod schema test + route handler returns 400. |
| REQ-006 | Yes | Yes | No | No | Mock Queue.upsertJobScheduler asserts arguments. |
| REQ-007 | Yes | Yes | No | No | Mock queue Spy on remove + add; assert per-channel diff logic. |
| REQ-008 | Yes | Yes | No | No | run-process post-write enqueue spy. |
| REQ-009 | Yes | Yes | No | No | Slack notifier called with review-pending payload; notificationState marker set. |
| REQ-010 | Yes | Yes | No | No | Handler unit test for reviewed/unreviewed branches. |
| REQ-011 | Yes | Yes | Yes | No | E2E: full pipeline → review → email fires → email sent to test inbox. |
| REQ-012 | Yes | Yes | No | No | Handler unit test for unreviewed publish path. |
| REQ-013 | Yes | Yes | No | No | Schema + repo helpers for notificationState. |
| REQ-014 | Yes | No | No | No | TZ helper unit tests for 4 IANA zones (VS-0a). |
| REQ-015 | Yes | Yes | No | No | Handler dispatch test. |
| REQ-016 | Yes | Yes | No | No | Worker dispatch table assertion; absence of `newsletter-send` branch. |
| REQ-017 | Yes | No | Yes | Yes | RTL component tests + Playwright e2e for Settings page; one manual smoke. |
| REQ-018 | Yes | Yes | No | No | Bootstrap function unit test + integration with mock queue. |
| REQ-019 | Yes | No | No | No | Mock queue.remove returns notFound; assert no throw. |
| REQ-020 | Yes | Yes | No | No | Notifier with throwing fetch mock; assert no exception escapes. |
| REQ-021 | Yes | Yes | No | No | Settings with scheduleEnabled=false; assert no pending jobs after reconcile. |
| REQ-022 | Yes | Yes | No | No | PATCH /api/admin/archives spy on reconcilePerArchiveJobs. |
| EDGE-001 | Yes | Yes | No | No | Negative-delay clamp + publish-failed path. |
| EDGE-002 | Yes | Yes | No | No | Two distinct runIds → two distinct jobIds. |
| EDGE-003 | Yes | No | No | No | Zod boundary test. |
| EDGE-004 | Yes | Yes | No | No | Reschedule spy. |
| EDGE-005 | Yes | No | No | No | Reschedule + idempotency together. |
| EDGE-006 | Yes | Yes | No | No | Enabled→disabled removes job. |
| EDGE-007 | Yes | Yes | No | No | Disabled→enabled enqueues. |
| EDGE-008 | Yes | No | No | No | DST test in TZ helper (Intl handles natively; fixed-clock unit test). |
| EDGE-009 | Yes | No | No | No | All-disabled + autoReview=false branch. |
| EDGE-010 | Yes | No | No | No | Slack webhook unset; notifier returns no-op. |
| EDGE-011 | Yes | Yes | No | No | scheduleEnabled flip removes pending. |
| EDGE-012 | Yes | No | No | No | failed/cancelled archives skip enqueue. |
| EDGE-013 | Yes | No | No | No | review-warning short-circuits if autoReview flips to true. |
| EDGE-014 | Yes | No | No | No | Already-fired removal is no-op. |
| EDGE-015 | Yes | No | No | No | Disabled-by-config doesn't notify Slack. |

## Verification Scenarios

These are functional verification scenarios for Stage 5 (`functional-verify` skill). They re-run the live behaviors verified during the library probe and the user-visible feature flows.

### VS-0 — Probe re-verification (carried from `library-probe.md`)

- **VS-0a**: Run `tz-probe.mjs` or its TypeScript equivalent under `vitest`; assert the 4 timezone cases round-trip. Required exit code 0.
- **VS-0b**: With a live Redis (`pnpm infra:up`), add a delayed BullMQ job with jobId `email-send:test`, remove it before the delay elapses, assert handler never runs (counter stays at 0).

### VS-1 — Admin saves valid 4-time schedule

Open `/admin/settings`, enter pipeline=19:00, email=09:00, linkedin=09:30, twitter=10:00, scheduleTimezone=America/New_York. Save succeeds (200). Confirm via DB query that all four fields are persisted and `pipeline-run:default` BullMQ scheduler exists with the expected pattern + tz. Confirm the next completed archive schedules publish jobs for the next local day.

### VS-2 — Admin saves equal-time violation

In the UI, set pipeline=09:00 and email=09:00. Click Save. Expect 400 response, inline error on `emailTime` field, Save button disabled. No DB write.

### VS-3 — Pipeline run with autoReview=false posts review-pending Slack

With `autoReview=false`, trigger `POST /api/runs/now`. After run completes, assert:
1. `run_archives` row written with `status='completed'`, `reviewed=false`.
2. Slack webhook received exactly one POST whose body mentions "review" and includes the archive URL.
3. `notificationState.reviewPending` is a valid ISO timestamp.

### VS-4 — Publish jobs fire and gate on reviewed state

With `autoReview=false`, settings pipeline=now+1min, email=now+3min, linkedin=now+4min, twitter=now+5min:
1. Trigger pipeline. Wait for archive write.
2. Without reviewing, wait for email-send fire time. Assert: no email sent, Slack receives publish-failed POST, `emailFailureNotifiedAt`-equivalent in `notificationState.emailFailure` is set.
3. Mark archive reviewed before linkedin-post fires. Assert linkedin posts successfully and `linkedinPostedAt` is set, no failure Slack.

### VS-5 — Settings change reschedules pending publish

Pipeline runs and archive is written with email scheduled for +30 min. Admin changes `emailTime` to +60 min. Assert: `email-send:<runId>` job is removed and re-added with the new delay (verify via BullMQ inspection script). The handler does not fire at the old time.

### VS-6 — Platform disable removes pending job

After pipeline archive write, linkedin-post is pending. Admin toggles `linkedinEnabled=false` and saves. Assert: `linkedin-post:<runId>` is removed. The handler never fires.

### VS-7 — Legacy `daily-run:default` scheduler is removed on boot

Pre-seed Redis with a `daily-run:default` BullMQ scheduler. Boot the API. Assert: `daily-run:default` is gone; `pipeline-run:default` exists with current settings.

## Out of Scope

- Multi-tenant scheduling. Singleton settings row remains the only configuration source.
- A configurable warning offset (the 5-minute lead time is hard-coded in this feature).
- Slack channel routing or message templating per channel — all five new notifications post to the same configured webhook.
- Migrating the `social-health` scheduler. It remains at `pipelineTime − 15 min` (existing behavior).
- Adding retries for failed publish jobs. A failed publish (other than "not reviewed") follows existing notifier behavior; we do not add a retry queue.
- Adding email/LinkedIn/Twitter providers or changing existing notifier mechanics. We only change *when* they fire and *what gates* their execution.
- Per-channel timezones. All four times share the single `scheduleTimezone` field.
- UI for inspecting per-archive job state (debugging is via BullMQ Inspect / logs).
- A "send now" override button that bypasses the schedule. Out of scope; the existing manual flows remain unchanged.
