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
| REQ-007 | Event-driven | When `PUT /api/settings` succeeds, the system shall reconcile standing publish schedulers for enabled channels. | `email-send:default`, `linkedin-post:default`, and `twitter-post:default` are upserted with empty payload `{}` when their channel is enabled; disabled channels are removed. Settings save does not scan archives or enqueue per-run publish jobs. | Must |
| REQ-008 | Event-driven | When `handleRunProcessJob` writes a terminal `run_archive` row, it shall not enqueue per-archive publish or review-warning jobs. | Successful runs persist the archive and may send review-pending Slack; failed terminal paths persist a `status='failed'`, `reviewed=false` archive row. `Queue.add` is not called for `email-send:<runId>`, `linkedin-post:<runId>`, `twitter-post:<runId>`, or `review-warning:<runId>`. | Must |
| REQ-009 | State-driven | While `autoReview=false` and the pipeline writes a `run_archive` with `status='completed'`, the system shall post a Slack **review-pending** message linking to `/admin/review/:runId`. | Single Slack POST issued; on success, `run_archives.notificationState.reviewPending` is set to the ISO timestamp. Posting failures are logged but never thrown. | Must |
| REQ-010 | Event-driven | When a scheduled publish job with no `runId` fires, it shall load the latest terminal pipeline archive by `completedAt DESC`. | No-runId jobs call `findLatestTerminal()`. Jobs with explicit `runId` keep exact-archive behavior for manual send and subscriber paths. | Must |
| REQ-011 | Event-driven | A scheduled publish job shall publish only when the latest terminal archive is `status='completed'`, `reviewed=true`, and the channel timestamp is null. | Email delivers to subscribers and marks `emailSentAt`; LinkedIn/Twitter post and mark their posted timestamps. Already-sent/posted channels no-op. | Must |
| REQ-012 | Unwanted | If the latest terminal archive is absent, failed, cancelled, or unreviewed, the scheduled publish job shall post a Slack **publish unavailable** error and exit without falling back to older reviewed archives. | Slack POST issued; `<channel>PostedAt` remains null. Older reviewed archives are never published when a newer terminal result is unreviewed or failed. | Must |
| REQ-013 | Ubiquitous | The system shall store all five Slack-notification idempotency markers in a single `notificationState` jsonb column on `run_archives`. | Schema: `notificationState jsonb` with shape `{ reviewPending, reviewWarning, emailFailure, linkedinFailure, twitterFailure }` (each ISO string or null). Migration adds the column nullable; existing rows default to `null` (treated as all-null). | Must |
| REQ-014 | Ubiquitous | The system shall compute "today at HH:MM in IANA timezone → epoch ms" using a zero-dependency `Intl.DateTimeFormat`-based helper. | Helper round-trips correctly for at least these timezones: `UTC`, `America/New_York`, `Europe/London`, `Asia/Kolkata`. No new npm dependency added. | Must |
| REQ-015 | Event-driven | When the `pipeline-run:default` job fires while `scheduleEnabled=true`, the system shall enqueue a `run-process` job using the current settings. | Behavior parity with current `handleDailyRunJob`: load settings, short-circuit if no sources enabled, otherwise call `startRun`. Only the scheduler-key name changes (`daily-run:default` → `pipeline-run:default`). | Must |
| REQ-016 | Ubiquitous | The system shall replace the `newsletter-send` BullMQ job and its handler with three new job names: `email-send`, `linkedin-post`, `twitter-post`. | `processing.ts` dispatch table contains three new branches and no `newsletter-send` branch. Old worker file is removed. The Slack send-summary call moves into `email-send`. | Must |
| REQ-017 | Ubiquitous | The system shall expose the four schedule times, the per-channel `enabled` flags, and the `autoReview` flag in the admin Settings UI. | `SettingsPage` renders four labeled HH:MM inputs, three Enabled toggles, and one Auto-review toggle. Client-side validation blocks Save when a publish time equals `pipelineTime` and shows per-field error text. | Must |
| REQ-018 | Event-driven | When the API process boots, the system shall remove the legacy `daily-run:default` scheduler if it exists and ensure `pipeline-run:default` is reconciled from current settings. | A bootstrap function calls `Queue.removeJobScheduler('daily-run:default')` once, then `reconcilePipelineSchedule(settings)`. Idempotent across reboots. | Must |
| REQ-019 | Ubiquitous | Scheduled publish jobs shall use empty payload `{}`; explicit/manual email jobs may still use `{ runId, subscriberIds? }`. | The channel schedulers are created with `data: {}`. Manual force-send keeps `{ runId }`. | Must |
| REQ-020 | Unwanted | If posting to Slack fails (network/HTTP error) for any of the five notification types, then the system shall log the error at `warn` level and not throw. | The underlying job/handler/request completes normally. The corresponding `notificationState` field remains `null` so a retry path can re-attempt. | Must |
| REQ-021 | State-driven | While `scheduleEnabled=false`, the system shall remove all standing schedulers owned by configurable schedules. | `pipeline-run:default`, `social-health:default`, `email-send:default`, `linkedin-post:default`, and `twitter-post:default` are removed. | Must |
| REQ-022 | Event-driven | When `PATCH /api/admin/archives/:runId` marks an archive as reviewed, the system shall save the review without scheduling per-archive publish jobs. | The route updates ranked items/reviewed state and does not call `Queue.add` for publish or review-warning jobs. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | A publish scheduler fires before the latest completed archive has been reviewed. | The worker posts publish-unavailable Slack and exits. It does not wait or publish older content. | REQ-010, REQ-012 |
| EDGE-002 | Pipeline runs twice the same day (manual `POST /api/runs/now` after the daily). | The latest terminal archive wins. If that latest archive is unreviewed or failed, publish jobs error and do not fall back to an older reviewed run. | REQ-010, REQ-012 |
| EDGE-003 | Admin saves settings with `emailTime=08:00, pipelineTime=08:00` (equal). | REQ-005 rejects with 400 naming `emailTime`. No DB write, no reconciliation. | REQ-005 |
| EDGE-004 | Admin changes `emailTime` from `09:00` to `10:00` after the pipeline already wrote the archive but before email-send fires. | REQ-007 updates `email-send:default`; the next email scheduler fire uses the new wall-clock time and resolves the latest terminal archive then. | REQ-007 |
| EDGE-005 | The latest terminal archive is `status='failed'`. | Scheduled publish posts Slack publish-unavailable and exits. It does not publish an older reviewed archive. | REQ-012 |
| EDGE-006 | `linkedinEnabled` flips from `true` to `false`. | REQ-007 removes `linkedin-post:default`. Other standing schedulers remain. | REQ-007, REQ-021 |
| EDGE-007 | `linkedinEnabled` flips from `false` to `true`. | REQ-007 upserts `linkedin-post:default` with the configured `linkedinTime` and empty payload `{}`. | REQ-007 |
| EDGE-008 | DST transition between pipeline run and a publish time (rare for half-hour offsets; relevant for US Spring-forward). | The TZ helper computes the wall-clock-to-UTC mapping using `Intl.DateTimeFormat` against the *now* timestamp, which already reflects DST status. Job fires at the wall-clock time configured. | REQ-014 |
| EDGE-009 | All three `*Enabled` flags are `false` and `autoReview=false`. | Pipeline still runs; archive is written; review-pending Slack is still posted. No publish channel schedulers exist. | REQ-007, REQ-009 |
| EDGE-010 | Slack webhook URL is unset. | All five new notification types (review-pending, review-warning, email-failure, linkedin-failure, twitter-failure) become no-ops; no idempotency markers are set; no error is thrown. | REQ-020 |
| EDGE-011 | Admin saves settings with `scheduleEnabled=false`. | REQ-021 removes pipeline, social-health, email, LinkedIn, and Twitter standing schedulers. | REQ-007, REQ-021 |
| EDGE-012 | Pipeline writes archive with `status='failed'` or `status='cancelled'`. | No review-pending Slack is posted. The failed row remains queryable so the next standing publish job can report the latest run failure. | REQ-008, REQ-012 |
| EDGE-013 | A scheduled publish job has no archive at all. | Publish-unavailable Slack is posted without a `runId`; no notification marker is written. | REQ-012 |
| EDGE-014 | A manual force-send job carries `{ runId }`. | The handler loads that exact archive and keeps the explicit-run behavior; it does not call latest-terminal resolution. | REQ-010, REQ-019 |
| EDGE-015 | `<channel>Enabled=true` in settings but the channel's notifier env vars are unset (e.g. `linkedinEnabled=true` but no `LINKEDIN_CLIENT_ID`). | Existing notifier behavior is preserved: the publish handler logs and skips. `<channel>PostedAt` is not set, but no Slack failure-notification is posted (this is a configuration error, not a review failure). | REQ-011 |
| EDGE-016 | Admin saves `pipelineTime=19:00` and `emailTime=09:00`. | REQ-005 accepts the settings. `email-send:default` fires daily at 09:00 in `scheduleTimezone`; the admin is responsible for choosing times that fit the review window. | REQ-005, REQ-007 |

## Verification Matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-001 | Yes | Yes | No | No | Drizzle migration test + repo upsert/get round-trip. |
| REQ-002 | Yes | No | No | No | Covered by REQ-014 helper tests. |
| REQ-003 | Yes | Yes | No | No | Unit: handler reads settings.autoReview. Integration: env-var fallback path. |
| REQ-004 | Yes | Yes | No | No | Repo round-trip + UI rendering. |
| REQ-005 | Yes | Yes | No | No | Zod schema test + route handler returns 400. |
| REQ-006 | Yes | Yes | No | No | Mock Queue.upsertJobScheduler asserts arguments. |
| REQ-007 | Yes | Yes | No | No | Mock Queue.upsertJobScheduler/removeJobScheduler asserts standing scheduler keys. |
| REQ-008 | Yes | Yes | No | No | run-process post-write test asserts no per-archive publish enqueue; failure paths persist failed archive rows. |
| REQ-009 | Yes | Yes | No | No | Slack notifier called with review-pending payload; notificationState marker set. |
| REQ-010 | Yes | Yes | No | No | Scheduled publish worker tests verify latest-terminal lookup; explicit `runId` skips it. |
| REQ-011 | Yes | Yes | Yes | No | Worker tests cover reviewed latest archive publish + timestamp marking. |
| REQ-012 | Yes | Yes | No | No | Worker tests cover no archive, latest failed, latest cancelled, and latest unreviewed. |
| REQ-013 | Yes | Yes | No | No | Schema + repo helpers for notificationState. |
| REQ-014 | Yes | No | No | No | TZ helper unit tests for 4 IANA zones (VS-0a). |
| REQ-015 | Yes | Yes | No | No | Handler dispatch test. |
| REQ-016 | Yes | Yes | No | No | Worker dispatch table assertion; absence of `newsletter-send` branch. |
| REQ-017 | Yes | No | Yes | Yes | RTL component tests + Playwright e2e for Settings page; one manual smoke. |
| REQ-018 | Yes | Yes | No | No | Bootstrap function unit test + integration with mock queue. |
| REQ-019 | Yes | No | No | No | Scheduler tests assert empty payload for standing jobs; route tests assert manual `{ runId }`. |
| REQ-020 | Yes | Yes | No | No | Notifier with throwing fetch mock; assert no exception escapes. |
| REQ-021 | Yes | Yes | No | No | Settings with scheduleEnabled=false removes all five standing schedulers. |
| REQ-022 | Yes | Yes | No | No | PATCH /api/admin/archives asserts no publish jobs are enqueued. |
| EDGE-001 | Yes | Yes | No | No | Negative-delay clamp + publish-failed path. |
| EDGE-002 | Yes | Yes | No | No | Two distinct runIds → two distinct jobIds. |
| EDGE-003 | Yes | No | No | No | Zod boundary test. |
| EDGE-004 | Yes | Yes | No | No | Standing scheduler time update spy. |
| EDGE-005 | Yes | No | No | No | Latest failed archive publish-unavailable worker test. |
| EDGE-006 | Yes | Yes | No | No | Enabled→disabled removes channel scheduler. |
| EDGE-007 | Yes | Yes | No | No | Disabled→enabled upserts channel scheduler. |
| EDGE-008 | Yes | No | No | No | DST test in TZ helper (Intl handles natively; fixed-clock unit test). |
| EDGE-009 | Yes | No | No | No | All-disabled + autoReview=false branch. |
| EDGE-010 | Yes | No | No | No | Slack webhook unset; notifier returns no-op. |
| EDGE-011 | Yes | Yes | No | No | scheduleEnabled flip removes standing schedulers. |
| EDGE-012 | Yes | No | No | No | failed archive row persisted and scheduled publish reports failure. |
| EDGE-013 | Yes | No | No | No | no-archive publish-unavailable path. |
| EDGE-014 | Yes | No | No | No | explicit runId worker path. |
| EDGE-015 | Yes | No | No | No | Disabled-by-config doesn't notify Slack. |

## Verification Scenarios

These are functional verification scenarios for Stage 5 (`functional-verify` skill). They re-run the live behaviors verified during the library probe and the user-visible feature flows.

### VS-0 — Probe re-verification (carried from `library-probe.md`)

- **VS-0a**: Run `tz-probe.mjs` or its TypeScript equivalent under `vitest`; assert the 4 timezone cases round-trip. Required exit code 0.
- **VS-0b**: With a live Redis (`pnpm infra:up`), upsert `email-send:default` with empty payload `{}`, then disable `emailEnabled` and assert the scheduler is removed.

### VS-1 — Admin saves valid 4-time schedule

Open `/admin/settings`, enter pipeline=19:00, email=09:00, linkedin=09:30, twitter=10:00, scheduleTimezone=America/New_York. Save succeeds (200). Confirm via DB query that all four fields are persisted and `pipeline-run:default`, `email-send:default`, `linkedin-post:default`, and `twitter-post:default` BullMQ schedulers exist with expected patterns + tz.

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
2. Without reviewing, wait for email-send fire time. Assert: no email sent and Slack receives publish-unavailable POST for the latest unreviewed archive.
3. Mark archive reviewed before linkedin-post fires. Assert linkedin posts successfully and `linkedinPostedAt` is set, no failure Slack.

### VS-5 — Settings change updates standing publish scheduler

Admin changes `emailTime` from 09:00 to 10:00. Assert: `email-send:default` is upserted with the new cron pattern and empty payload `{}`. No archives are scanned.

### VS-6 — Platform disable removes standing channel scheduler

Admin toggles `linkedinEnabled=false` and saves. Assert: `linkedin-post:default` is removed. Email and Twitter schedulers remain if enabled.

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
- UI for inspecting standing scheduler state (debugging is via BullMQ Inspect / logs).
- A "send now" override button that bypasses the schedule. Out of scope; the existing manual flows remain unchanged.
