# Configurable Per-Task Schedules — Design

**Date:** 2026-05-18
**Status:** Approved (brainstorm phase)
**Linear:** VER-TBD (configurable-schedule-settings)
**Worktree:** `.worktrees/configurable-schedule-settings`

---

## Problem Statement

Today the admin can configure a single daily `scheduleTime` that drives both the pipeline run and (implicitly) all downstream publishing. Email send, LinkedIn post, and X/Twitter post all fire from one `newsletter-send` job that's triggered either right after AUTO_REVIEW completes or right after the operator clicks "Review & Send."

We need **four independently scheduled times**:

1. Pipeline run
2. Email send
3. LinkedIn post
4. Twitter post

…with the hard ordering rule **pipeline < min(email, linkedin, twitter)** and three new Slack notifications:

- **Review-pending**: when AUTO_REVIEW=false and pipeline finishes, ask the operator to review.
- **Review-warning**: 5 min before the earliest publish, if the archive still isn't reviewed.
- **Publish-failed**: when a publish job fires and the archive isn't reviewed, post a per-channel failure message.

## Context

- Single-tenant admin tool (Aman + Ritesh). One singleton `user_settings` row.
- Existing `daily-run` BullMQ repeatable scheduled via `reconcileDailyRunSchedule()` in `packages/api/src/services/scheduler.ts`.
- `newsletter-send` worker bundles email + Slack send-summary + LinkedIn + Twitter today. Idempotency via `slackNotifiedAt` / `linkedinPostedAt` / `twitterPostedAt` columns on `run_archives`.
- `AUTO_REVIEW` is currently `process.env.AUTO_REVIEW === "true"`, consumed in `run-process.ts`.

## Requirements

### Functional

- **FR-1** Settings supports four independent HH:MM fields: `pipelineTime`, `emailTime`, `linkedinTime`, `twitterTime`. All share one `scheduleTimezone`.
- **FR-2** Server validates that no publish time equals `pipelineTime` on PUT. Publish times earlier than `pipelineTime` are valid and target the next local day. 400 with per-field error when violated.
- **FR-3** `autoReview` boolean moves into `user_settings` (was env var). Env stays as initial-seed only.
- **FR-4** Pipeline run is a standing daily BullMQ repeatable, keyed by `pipelineTime`/`scheduleTimezone`.
- **FR-5** Publish channels are standing BullMQ schedulers, not per-archive delayed jobs:
  - `email-send:default` at `emailTime` (present only when `emailEnabled=true`)
  - `linkedin-post:default` at `linkedinTime` (present only when `linkedinEnabled=true`)
  - `twitter-post:default` at `twitterTime` (present only when `twitterPostEnabled=true`)
  Each scheduled publish job carries an empty payload `{}` and resolves the latest terminal pipeline archive at execution time.
- **FR-6** When AUTO_REVIEW=false and the pipeline writes the archive, post a Slack **review-pending** notification. Idempotent via `run_archives.notificationState.reviewPending`.
- **FR-7** The review-warning delayed job is removed from this feature. Review reminders may be reintroduced later as a separate reminder capability.
- **FR-8** Each scheduled publish job (`email-send`/`linkedin-post`/`twitter-post`) loads the latest terminal archive by `completedAt DESC`:
  - If the latest archive is `status='completed'`, `reviewed=true`, and the channel timestamp is null → publish and mark `<channel>PostedAt`.
  - If the latest archive is unreviewed, failed, cancelled, or absent → post a Slack **publish unavailable** error and exit.
  - If the latest archive was already sent/posted for that channel → no-op.
  - It must never publish an older reviewed archive when a newer terminal run is unreviewed or failed.
- **FR-9** Manual/explicit jobs may still carry `{ runId }` and keep exact-run behavior for force-send and subscriber-specific paths.
- **FR-10** Settings reconciliation upserts or removes the standing publish schedulers. Changing a time updates that channel's `*:default` scheduler; disabling a channel removes only that channel scheduler.

### Non-Functional

- **NFR-1** All schedules must respect `scheduleTimezone` (including DST). `pipelineTime` already does this via BullMQ `tz` option; same approach for delayed-job computation (use `date-fns-tz` or Luxon — TBD whether one is already in stack).
- **NFR-2** Reconciliation must be idempotent: PUTting the same settings twice produces the same scheduler state.
- **NFR-3** Slack notifications must never block the underlying job. Failure to notify is logged, never thrown.
- **NFR-4** Migration: existing `user_settings.scheduleTime` becomes `pipelineTime`. `emailTime`/`linkedinTime`/`twitterTime` default to `pipelineTime + 30min` (clamped to `pipelineTime + 5min` minimum) so existing deployments behave sensibly without operator action.
- **NFR-5** The old `daily-run:default` repeatable key is removed; the new key is `pipeline-run:default`. Migration drops the old key on first boot.

### Edge cases

- **EC-1** Pipeline run delayed/late so the scheduled publish fires before review → the standing publish job checks the latest terminal archive and posts a Slack error if it is not reviewed.
- **EC-2** Pipeline runs twice in one day (manual `POST /api/runs/now` after the daily) → the latest terminal archive wins. A publish job never falls back to the older reviewed run if the newer one failed or still needs review.
- **EC-3** Settings change after pipeline fires but before email fires (the explicit user-requested case): API updates the standing channel scheduler. The admin is responsible for choosing times that fit the desired review window.
- **EC-4** Any publish time equal to pipeline time → rejected by FR-2.
- **EC-5** No archive exists yet when a publish scheduler fires → Slack error notification, no publish.
- **EC-6** `scheduleEnabled=false` → all standing schedulers are removed (`pipeline-run:default`, `social-health:default`, and publish channel schedulers).
- **EC-7** Publish time earlier than pipeline time (e.g. pipeline 19:00, email 09:00) → accepted as an operator choice; the channel scheduler fires at 09:00 daily in `scheduleTimezone`.

## External Dependencies & Fallback Chain

**None — pure-internal feature.**

All capabilities used already exist in the stack:

- **BullMQ `upsertJobScheduler`** — already used for `daily-run`. Reused for `pipeline-run:default` and the three standing publish schedulers.
- **Drizzle migrations** — already in stack.
- **Slack webhook posting** — `packages/shared/src/slack/notifier.ts` already exists; we extend it with three new message builders.
- **Timezone math (HH:MM + TZ → Date)** — check `package.json` for `date-fns-tz` or `luxon`. If neither is present, the planner can adopt `date-fns-tz` (small, focused, MIT). Probe verifies this in stage 1.5.

If timezone library probing reveals neither is present and `date-fns-tz` is added, fallback chain: `date-fns-tz` → `luxon` → hand-rolled IANA offset computation via `Intl.DateTimeFormat`. Last fallback is implementable in ≤30 LOC and zero deps.

## Key Insights

- **The latest terminal run binds scheduled publish.** Standing publish jobs run at channel times and inspect the most recent terminal archive. This keeps the pipeline, Slack review notification, and channel publish schedulers disjoint and simple.
- **No fallback protects correctness.** If the newest terminal run failed or is unreviewed, the scheduler sends a Slack error and exits. Publishing an older reviewed archive would hide the current run's problem and send stale content.
- **Settings updates only affect standing schedulers.** PUT /settings updates the pipeline, social-health, and channel scheduler keys. It does not scan archives or reconcile per-run jobs.
- **`notificationState` jsonb on `run_archives` consolidates five new idempotency markers** without explosion of columns.
- **The publish schedulers are standing repeatables too.** They are intentionally disjoint from pipeline completion and review save events.

## Architectural Challenges

| Challenge | Resolution |
|-----------|-----------|
| Computing "today at HH:MM in TZ" robustly across DST | Probe `date-fns-tz` / `luxon` in stage 1.5; pick the present one. |
| Reschedule semantics on settings change | API PUT reconciles standing scheduler keys only. Publish workers resolve archives at execution time. |
| Migration of singleton settings | Drizzle migration: add 4 new HH:MM columns + autoReview + enabled columns + notificationState jsonb. Default `pipelineTime = old scheduleTime`. Default publish times = `pipelineTime + 30 min` (caller can edit immediately). |
| Removing the old `daily-run:default` BullMQ scheduler | On API boot, after migration runs, `removeJobScheduler('daily-run:default')` then upsert `pipeline-run:default`. Wrapped in a one-time reconcile call in the API bootstrap. |
| AUTO_REVIEW env → settings | Read settings.autoReview in `run-process.ts`. Env var (if set) is used as the default seed during the initial `INSERT` of the singleton settings row; once the row exists, env is ignored. |
| Worker decomposition | `newsletter-send.ts` → three new workers: `email-send.ts`, `linkedin-post.ts`, `twitter-post.ts`. The "Slack send-summary" notification moves into `email-send.ts` (preserves existing UX). Old `newsletter-send` job name is removed; nothing in queue uses it after migration. |

## High-Level Design

### Settings schema (Drizzle)

```
user_settings (singleton)
  pipelineTime      text  NOT NULL  -- HH:MM (was scheduleTime)
  emailTime         text  NOT NULL  -- HH:MM
  linkedinTime      text  NOT NULL  -- HH:MM
  twitterTime       text  NOT NULL  -- HH:MM
  scheduleTimezone  text  NOT NULL  -- unchanged
  scheduleEnabled   boolean         -- unchanged (master kill switch)
  autoReview        boolean NOT NULL DEFAULT false  -- NEW (moved from env)
  emailEnabled      boolean NOT NULL DEFAULT true   -- NEW
  linkedinEnabled   boolean NOT NULL DEFAULT true   -- NEW
  twitterEnabled    boolean NOT NULL DEFAULT true   -- NEW
  ...existing source config columns...
```

`run_archives` adds one column:

```
notificationState  jsonb  -- {
                           --   reviewPending: ISO timestamp | null,
                           --   reviewWarning: ISO timestamp | null,
                           --   emailFailure:   ISO timestamp | null,
                           --   linkedinFailure: ISO timestamp | null,
                           --   twitterFailure: ISO timestamp | null
                           -- }
```

### BullMQ topology

| Key | Type | Trigger |
|-----|------|---------|
| `pipeline-run:default` | repeatable scheduler (replaces `daily-run:default`) | settings save (`reconcilePipelineSchedule`) |
| `social-health:default` | repeatable scheduler | settings save (`pipelineTime - 15 min`) |
| `email-send:default` | repeatable scheduler | settings save when `emailEnabled=true` |
| `linkedin-post:default` | repeatable scheduler | settings save when `linkedinEnabled=true` |
| `twitter-post:default` | repeatable scheduler | settings save when `twitterPostEnabled=true` |

The old `social-health` repeatable is retained (15 min before pipeline) — out of scope.

### Worker decomposition

The dispatching `processing.ts` worker grows three new branches. The single `newsletter-send` handler is split:

- `handleEmailSendJob(deps, job)` — subscribers email + Slack send-summary
- `handleLinkedInPostJob(deps, job)` — LinkedIn auto-post
- `handleTwitterPostJob(deps, job)` — X/Twitter auto-post
Each scheduled handler:

1. If `job.data.runId` exists, loads that exact archive (manual/explicit path).
2. Otherwise, loads the latest terminal archive by `completedAt DESC`.
3. If the latest archive is missing, failed, cancelled, or unreviewed → post Slack publish-unavailable and exit.
4. If `reviewed=true` and channel `<channel>PostedAt` is null → publish + mark.
5. If `<channel>PostedAt` already set → no-op.

### Slack notification additions

`packages/shared/src/slack/notifier.ts` grows sender methods for the new review and publish-error surfaces:

- `notifyReviewPending(runId)` — when pipeline finishes and autoReview=false
- `notifyPublishFailed(runId, channel)` — explicit-run publish job found its archive unreviewed
- `notifyPublishUnavailable(channel, reason, runId?)` — standing publish job could not publish the latest terminal run

Run-bound notifications use `notificationState` jsonb on `run_archives` for idempotency. The no-archive publish-unavailable path has no run marker and simply posts/logs. The existing `notifyNewsletterSent` (send-summary) stays as-is and moves into `email-send` handler.

### Settings UI

`packages/web/src/pages/SettingsPage.tsx` + `components/settings/ScheduleSection.tsx`:

- Replace single "Schedule Time" with a 4-row grid: Pipeline / Email / LinkedIn / Twitter, each HH:MM input.
- Add an "Auto-review" toggle.
- Add a per-channel "Enabled" toggle (next to each time row).
- Client-side validation mirrors server: publish times must differ from pipeline time. Earlier publish times are labeled/treated as next-day windows. Show inline error and disable Save until resolved.
- The existing timezone picker stays.

### API surface

- `GET /api/settings` — returns the new shape (additive, no breaking change for an admin-only tool).
- `PUT /api/settings` — validates equal-time conflicts and calls `reconcilePipelineSchedule` to upsert/remove standing schedulers.
- No new routes.

## Approaches Considered

### A. Standing repeatables for all publish channels + latest-terminal resolver (chosen)

Pipeline and publish jobs are BullMQ repeatables. Publish jobs fire daily, load the latest terminal archive by `completedAt DESC`, and either publish the latest reviewed run or post Slack error. **Pros:** simple disjoint systems, no run-bound delayed publish jobs, no archive scan on settings save, no stale fallback. **Cons:** operators must choose sensible review windows. **Verdict:** chosen.

### B. One-time delayed per-archive jobs + standing pipeline (rejected)

Pipeline stays a repeatable. Publish jobs are one-time delays enqueued at archive-write. Settings changes mutate pending jobs. **Pros:** runId binding is unambiguous. **Cons:** couples pipeline completion, review save, and settings save to per-run queue reconciliation. **Verdict:** rejected for this simplification.

### C. Cron + DB row "today's plan" (rejected)

Single cron fires every minute, polls DB for due actions. **Pros:** no BullMQ scheduling logic. **Cons:** introduces polling we don't need, no idempotency by design, has to handle clock drift. **Verdict:** rejected as a regression of the existing BullMQ-native pattern.

## Open Questions for Planner

- Whether to keep `social-health` repeatable scheduled at `pipelineTime - 15 min` or move it to `min(emailTime,linkedinTime,twitterTime) - 15 min`. Bias: keep as-is — orthogonal to this work.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A scheduled publish job could publish stale content after a newer failed run | M | H | Latest-terminal gate treats failed/cancelled/unreviewed newest runs as blocking and sends Slack error. |
| Settings change after a job has already fired but before publish completes | L | L | Settings only affect future scheduler fires; the running handler completes normally. |
| Migration leaves a stale `daily-run:default` scheduler in Redis | M | M | API bootstrap explicitly removes `daily-run:default` after migration. |
| Pipeline runs twice in a day (manual + auto) leaves multiple archives | L | M | Publish jobs always select the latest terminal row and never fall back. Operator clarity. |

## Assumptions

- Single timezone shared across all four times. (Confirmed.)
- A single singleton settings row. (Existing.)
- Operator runs zero or one pipeline per day. (Existing assumption; EC-2 documents the multi-run case.)
- Slack webhook URL is set. If unset, all five new notifications are no-ops (mirrors existing behavior).
- The 5-minute warning offset is hard-coded (not configurable). Open to change if planner spots a strong reason.
