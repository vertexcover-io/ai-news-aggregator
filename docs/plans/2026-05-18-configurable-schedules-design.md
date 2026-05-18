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
- **FR-5** When the pipeline run writes the `run_archive` row, it enqueues **per-archive delayed BullMQ jobs**:
  - `email-send` at the archive's `emailTime` window (skip if `emailEnabled=false`)
  - `linkedin-post` at the archive's `linkedinTime` window (skip if `linkedinEnabled=false`)
  - `twitter-post` at the archive's `twitterTime` window (skip if `twitterEnabled=false`)
  - `review-warning` at `min(email, linkedin, twitter) - 5 min` (skip when `autoReview=true`)
  Each carries `{ runId }` in its payload. Job IDs are deterministic: `<task>:<runId>` (BullMQ idempotency).
- **FR-6** When AUTO_REVIEW=false and the pipeline writes the archive, post a Slack **review-pending** notification. Idempotent via `run_archives.notificationState.reviewPending`.
- **FR-7** `review-warning` job: if archive still unreviewed → post Slack warning. Idempotent via `notificationState.reviewWarning`. No-op if reviewed.
- **FR-8** Each publish job (`email-send`/`linkedin-post`/`twitter-post`):
  - If archive `reviewed=true` → execute the publish, mark `<channel>PostedAt`.
  - If archive `reviewed=false` → post Slack **publish-failed** for that channel ("Email was not sent — newsletter not reviewed in time"). Idempotent via `notificationState.<channel>Failure`.
- **FR-9** When admin saves settings *after* a pipeline run has completed but before all publish jobs have fired, the API must **reschedule the still-pending publish jobs** for that archive to the new times. Implementation: remove the existing delayed job by deterministic ID, re-enqueue with the new delay. Already-fired jobs are not touched.
- **FR-10** If a platform's `enabled` flag flips to `false` after enqueue but before fire, the still-pending job is removed by deterministic ID.

### Non-Functional

- **NFR-1** All schedules must respect `scheduleTimezone` (including DST). `pipelineTime` already does this via BullMQ `tz` option; same approach for delayed-job computation (use `date-fns-tz` or Luxon — TBD whether one is already in stack).
- **NFR-2** Reconciliation must be idempotent: PUTting the same settings twice produces the same scheduler state.
- **NFR-3** Slack notifications must never block the underlying job. Failure to notify is logged, never thrown.
- **NFR-4** Migration: existing `user_settings.scheduleTime` becomes `pipelineTime`. `emailTime`/`linkedinTime`/`twitterTime` default to `pipelineTime + 30min` (clamped to `pipelineTime + 5min` minimum) so existing deployments behave sensibly without operator action.
- **NFR-5** The old `daily-run:default` repeatable key is removed; the new key is `pipeline-run:default`. Migration drops the old key on first boot.

### Edge cases

- **EC-1** Pipeline run delayed/late so today's `emailTime` is already past at archive-write time → enqueue with `delay=0` (BullMQ fires immediately).
- **EC-2** Pipeline runs twice in one day (manual `POST /api/runs/now` after the daily) → second archive overwrites the first's pending publish jobs because job IDs collide on `<task>:<runId>` — different runId, so they coexist. **Both will fire**, and only the reviewed one gets published; the other will post a publish-failed message. This is acceptable for MVP; documented as a known behavior.
- **EC-3** Settings change after pipeline fires but before email fires (the explicit user-requested case): API computes the diff, finds pending jobs by deterministic ID, removes them, re-enqueues at new times. Tested in unit + e2e.
- **EC-4** Any publish time equal to pipeline time → rejected by FR-2.
- **EC-5** Review-warning would land in the past (e.g. emailTime is 5min after pipelineTime) → still enqueued with `delay=0`; fires immediately; if archive not reviewed yet, posts warning. Acceptable.
- **EC-6** `scheduleEnabled=false` → all jobs cancelled (existing pipeline + any per-archive pending). Same as today.
- **EC-7** Publish time earlier than pipeline time (e.g. pipeline 19:00, email 09:00) → accepted and scheduled for the next local day anchored to the archive's `completedAt` date.

## External Dependencies & Fallback Chain

**None — pure-internal feature.**

All capabilities used already exist in the stack:

- **BullMQ delayed jobs** (`Queue.add(name, data, { delay, jobId })`) — supported since v4. Already vendored. Removal by jobId via `Queue.remove(jobId)`.
- **BullMQ `upsertJobScheduler`** — already used for `daily-run`. Reused for `pipeline-run:default`.
- **Drizzle migrations** — already in stack.
- **Slack webhook posting** — `packages/shared/src/slack/notifier.ts` already exists; we extend it with three new message builders.
- **Timezone math (HH:MM + TZ → Date)** — check `package.json` for `date-fns-tz` or `luxon`. If neither is present, the planner can adopt `date-fns-tz` (small, focused, MIT). Probe verifies this in stage 1.5.

If timezone library probing reveals neither is present and `date-fns-tz` is added, fallback chain: `date-fns-tz` → `luxon` → hand-rolled IANA offset computation via `Intl.DateTimeFormat`. Last fallback is implementable in ≤30 LOC and zero deps.

## Key Insights

- **The runId binds the work, not a date.** The user's clarification is the key architectural insight: each scheduled publish job carries the runId in its payload. No "which archive is today's?" resolver is needed; the archive that triggered enqueue is the archive that gets published. This eliminates a whole class of race conditions and the "what if pipeline runs late" ambiguity.
- **Delayed jobs > standing repeatables for publish.** A standing repeatable runs blind every day; a delayed-per-archive job runs only when there's something to publish. Cancellation is trivial (`Queue.remove(jobId)`). Idempotency is free via `jobId`.
- **Settings updates must propagate to pending jobs.** The user explicitly called this out; it's the most subtle requirement. The PUT /settings handler diffs old vs new times and re-enqueues any still-pending per-archive jobs.
- **`notificationState` jsonb on `run_archives` consolidates five new idempotency markers** without explosion of columns.
- **The pipeline is the only standing repeatable** in the new topology. Everything else is per-archive, runId-bound, delayed.

## Architectural Challenges

| Challenge | Resolution |
|-----------|-----------|
| Computing "today at HH:MM in TZ" robustly across DST | Probe `date-fns-tz` / `luxon` in stage 1.5; pick the present one. |
| Reschedule semantics on settings change | API PUT diffs times; for each `run_archive` in `(status='completed' AND reviewed=any AND not all channels posted)`, recompute target time and remove+re-add jobs by deterministic ID. Encapsulated in a `reconcilePerArchiveJobs(runId, settings)` service. |
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
| `email-send:<runId>` | one-time delayed | enqueued by pipeline post-archive-write; re-enqueued on settings PUT |
| `linkedin-post:<runId>` | one-time delayed | same |
| `twitter-post:<runId>` | one-time delayed | same |
| `review-warning:<runId>` | one-time delayed | same (skipped when autoReview=true) |

The old `social-health` repeatable is retained (15 min before pipeline) — out of scope.

### Worker decomposition

The dispatching `processing.ts` worker grows three new branches. The single `newsletter-send` handler is split:

- `handleEmailSendJob(deps, job)` — subscribers email + Slack send-summary
- `handleLinkedInPostJob(deps, job)` — LinkedIn auto-post
- `handleTwitterPostJob(deps, job)` — X/Twitter auto-post
- `handleReviewWarningJob(deps, job)` — Slack warning if not reviewed

Each handler:

1. Loads `run_archive` by `job.data.runId`.
2. If `reviewed=false` AND it's a publish job → post `publish-failed` Slack (idempotent via `notificationState.<channel>Failure`), exit.
3. If `reviewed=true` AND channel `<channel>PostedAt` is null → publish + mark.
4. If `<channel>PostedAt` already set → no-op (idempotency).

### Reconcile service

A new `services/per-archive-schedule.ts` in pipeline (or api — TBD by planner):

```
reconcilePerArchiveJobs(queue, runId, settings):
  archive = archiveRepo.findById(runId)
  if archive.status !== "completed" → return
  for each channel in [email, linkedin, twitter, review-warning]:
    desired = computeDesiredTime(archive, settings, channel)
    if alreadyPosted(channel) or channelDisabled(settings, channel)
       or (channel=warning and settings.autoReview):
      await queue.remove(jobId(channel, runId))
    else:
      await queue.remove(jobId(channel, runId))      // idempotent
      await queue.add(channel, {runId}, {jobId: jobId(channel, runId), delay: desired - now})
```

Called from:

- Pipeline's `run-process` after archive write.
- API's `PUT /api/settings` after settings save — iterate over recent unpublished archives (typically 0–1 rows).
- API's `PATCH /api/admin/archives/:runId` on review completion — no-op for time changes but ensures jobs exist if archive was somehow created without them.

### Slack notification additions

`packages/shared/src/slack/notifier.ts` grows four new builders + sender methods:

- `notifyReviewPending(runId)` — when pipeline finishes and autoReview=false
- `notifyReviewWarning(runId, minutesUntilFirstPublish)` — 5-min warning
- `notifyPublishFailure(runId, channel, reason)` — channel ∈ {email, linkedin, twitter}

All four use `notificationState` jsonb on `run_archives` for idempotency. The existing `notifyNewsletterSent` (send-summary) stays as-is and moves into `email-send` handler.

### Settings UI

`packages/web/src/pages/SettingsPage.tsx` + `components/settings/ScheduleSection.tsx`:

- Replace single "Schedule Time" with a 4-row grid: Pipeline / Email / LinkedIn / Twitter, each HH:MM input.
- Add an "Auto-review" toggle.
- Add a per-channel "Enabled" toggle (next to each time row).
- Client-side validation mirrors server: publish times must differ from pipeline time. Earlier publish times are labeled/treated as next-day windows. Show inline error and disable Save until resolved.
- The existing timezone picker stays.

### API surface

- `GET /api/settings` — returns the new shape (additive, no breaking change for an admin-only tool).
- `PUT /api/settings` — validates ordering, calls `reconcilePipelineSchedule` + `reconcilePerArchiveJobs` for any unpublished recent archives.
- No new routes.

## Approaches Considered

### A. Standing repeatables for all 5 + DB resolver (rejected)

All five jobs are BullMQ repeatables. Each fires daily, looks up "today's archive" by date, then acts. **Pros:** Uniform topology. **Cons:** Resolver ambiguity if pipeline runs late, late settings changes need scheduler reconcile (not job reschedule), and the user explicitly rejected this in favor of runId-binding. **Verdict:** rejected.

### B. One-time delayed per-archive jobs + standing pipeline (chosen)

Pipeline stays a repeatable. Publish jobs are one-time delays enqueued at archive-write. Settings changes mutate pending jobs. **Pros:** runId binding is unambiguous; cancellation/reschedule trivial via deterministic jobId; queue stays empty when no work pending. **Cons:** "Settings change → reschedule" code path is new and must be tested. **Verdict:** chosen — matches user clarification.

### C. Cron + DB row "today's plan" (rejected)

Single cron fires every minute, polls DB for due actions. **Pros:** no BullMQ scheduling logic. **Cons:** introduces polling we don't need, no idempotency by design, has to handle clock drift. **Verdict:** rejected as a regression of the existing BullMQ-native pattern.

## Open Questions for Planner

- Does `date-fns-tz` or `luxon` already exist in `package.json`? If not, the planner picks one (probe in 1.5 verifies). Hand-rolled IANA via `Intl.DateTimeFormat` is the final fallback.
- Should `reconcilePerArchiveJobs` live in `@newsletter/api` (called from PUT /settings + PATCH /archive) or in `@newsletter/pipeline` services? Bias: `@newsletter/api` so the queue handle is already available. The pipeline post-archive-write call uses a small shared helper.
- Whether to keep `social-health` repeatable scheduled at `pipelineTime - 15 min` or move it to `min(emailTime,linkedinTime,twitterTime) - 15 min`. Bias: keep as-is — orthogonal to this work.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BullMQ `Queue.remove(jobId)` fails to find a pending delayed job and silently no-ops | M | L | Add explicit "found/not-found" log; tests assert removal success. |
| DST transition causes a publish time to skip or repeat | L | M | Compute target Date via TZ-aware library; e2e test asserts a fall-back-DST scenario. |
| Settings change after a job has already fired but before publish completes | L | L | We don't reschedule jobs already past their delay; the running handler completes normally. |
| Migration leaves a stale `daily-run:default` scheduler in Redis | M | M | API bootstrap explicitly removes `daily-run:default` after migration. |
| Pipeline runs twice in a day (manual + auto) creates two sets of publish jobs | L | L | Documented in EC-2. Each archive carries its own runId; both run; only reviewed ones publish. Operator clarity. |
| Reviewer changes settings *during* the 5-min warning window | L | L | Warning fires from a job that already has its time baked in; the reschedule path applies. Worst case: warning fires twice (once at old time, once at new) — idempotency in `notificationState.reviewWarning` makes the second a no-op. |

## Assumptions

- Single timezone shared across all four times. (Confirmed.)
- A single singleton settings row. (Existing.)
- Operator runs zero or one pipeline per day. (Existing assumption; EC-2 documents the multi-run case.)
- Slack webhook URL is set. If unset, all five new notifications are no-ops (mirrors existing behavior).
- The 5-minute warning offset is hard-coded (not configurable). Open to change if planner spots a strong reason.
