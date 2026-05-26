# SPEC: Late-Review Publish Trigger

**Source:** docs/spec/late-review-publish-trigger/design.md
**Generated:** 2026-05-26

## Summary

When the admin reviews a newsletter after a channel's scheduled publish time has already
passed, that channel must publish **immediately** upon review completion. Channels whose
scheduled time is still in the future continue to publish via their existing daily cron.
The fix adds a pure decision helper (`selectImmediatePublishChannels`) in
`@newsletter/shared/scheduling` and an enqueue side-effect on the review-save endpoint
(`PATCH /api/admin/archives/:runId`). No schema change, no new dependency, no
pipeline-package change. Double-publish is prevented by the workers' existing idempotency
on `emailSentAt`/`linkedinPostedAt`/`twitterPostedAt`.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When a review save (`PATCH /api/admin/archives/:runId`) transitions an archive to reviewed, the system shall evaluate each publish channel (email, linkedin, twitter) for immediate publish. | After a successful patch that marks `reviewed=true`, `selectImmediatePublishChannels` is invoked once with the archive's `completedAt` and current time. | Must |
| REQ-002 | Event-driven | When a channel is enabled and its scheduled publish moment for the run has already passed at review time, the system shall enqueue that channel's publish job immediately (`delay: 0`) targeting the reviewed `runId`. | For a past-due enabled channel, `processingQueue.add(<jobName>, { runId }, { jobId: "<jobName>:<runId>", delay: 0 })` is called exactly once; `jobName` ∈ {`email-send`,`linkedin-post`,`twitter-post`}. | Must |
| REQ-003 | State-driven | While a channel's scheduled publish moment is still in the future at review time, the system shall NOT enqueue that channel immediately. | For a future-scheduled channel, no `processingQueue.add` call is made for that channel; it is reported as deferred. | Must |
| REQ-004 | Unwanted | If a channel is disabled (`!channelEnabled`) or scheduling is off (`!scheduleEnabled`), then the system shall not enqueue that channel immediately. | `selectImmediatePublishChannels` returns `[]` when `scheduleEnabled=false`; a channel with its enable flag false is never in the returned set. | Must |
| REQ-005 | Ubiquitous | The system shall compute each channel's scheduled publish moment via `publishDateForWindow({ timezone: scheduleTimezone, pipelineTime, publishTime: channelTime, completedAt })`. | The per-channel moment equals `publishDateForWindow` output for that channel's time; "past-due" is `now > scheduledMoment` (strict). | Must |
| REQ-006 | Unwanted | If a channel's window computation throws (missing/malformed settings, or `channelTime === pipelineTime`), then the system shall treat that channel as not past-due and omit it. | When `publishDateForWindow` throws for a channel, that channel is absent from the returned set and no job is enqueued for it; the helper never throws. | Must |
| REQ-007 | Ubiquitous | The system shall keep the existing daily cron repeatables unchanged as the publish mechanism for reviewed-before-scheduled-time. | `reconcilePipelineSchedule` and the three cron schedulers are unmodified; baseline scheduler tests still pass. | Must |
| REQ-008 | Unwanted | If a channel's send timestamp is already set (`emailSentAt`/`linkedinPostedAt`/`twitterPostedAt`) at review time, then the system shall not enqueue that channel immediately. | A channel whose archive timestamp is non-null is skipped by the route's pre-check (redundant with worker idempotency). | Should |
| REQ-009 | Event-driven | When the immediate path enqueues or defers channels, the system shall log the decision at `info` with the runId and channel. | An `info` log line with `event: "archive.immediate_publish_enqueued"` (per enqueued channel) and a deferred-channels log are emitted. | Should |
| REQ-010 | Unwanted | If `deps.processingQueue` is absent, then the immediate-publish path shall be a no-op. | With `processingQueue` undefined, no enqueue is attempted and the PATCH still returns the updated archive (200). | Must |
| REQ-011 | Ubiquitous | The immediate-publish path and the daily cron shall never cause a channel to publish twice for the same run. | An e2e test that triggers both an immediate enqueue and a cron-equivalent dispatch results in exactly one send per channel (second is skipped on the sent timestamp). | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `scheduleTimezone`/`pipelineTime`/`channelTime` missing or malformed `HH:MM` | Channel omitted from immediate set (window throw caught); helper returns without throwing. | REQ-006 |
| EDGE-002 | `channelTime === pipelineTime` (window function throws by contract) | That channel omitted; other valid channels still evaluated. | REQ-006 |
| EDGE-003 | `autoReview = true` (archive reviewed at pipeline-finish, not via PATCH) | Immediate path not on this code path; cron publishes as today. No regression. | REQ-001 |
| EDGE-004 | Re-saving an already-reviewed archive after a late publish already sent a channel | Either no transition (no enqueue) OR enqueue dedups by `jobId` and worker skips on sent timestamp — no double-send. | REQ-008, REQ-011 |
| EDGE-005 | Review exactly at the scheduled minute (`now === scheduledMoment`) | Strict `>` means not past-due → deferred to cron; if a few-second race fires both, idempotency absorbs it. | REQ-005, REQ-011 |
| EDGE-006 | Cron already fired at `channelTime` while unreviewed and exited; admin reviews later | Immediate path fires (now > scheduledMoment) — the core scenario; channel publishes. | REQ-002 |
| EDGE-007 | Email past-due (08:00) but LinkedIn future (18:00) at review time | Email enqueued immediately; LinkedIn deferred to its cron — per-channel independence. | REQ-002, REQ-003 |
| EDGE-008 | All three channels past-due at review time | All three enqueued immediately, each targeting the runId. | REQ-002 |
| EDGE-009 | `scheduleEnabled = false` | `selectImmediatePublishChannels` returns `[]`; nothing enqueued. | REQ-004 |
| EDGE-010 | One channel disabled, two enabled and past-due | Only the two enabled past-due channels enqueued. | REQ-004 |
| EDGE-011 | `completedAt` such that `publishDateForWindow` rolls to the next day (`channelTime < pipelineTime`) | Scheduled moment is next-day occurrence; past-due decision uses that moment consistently with `published_at`. | REQ-005 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | Yes | No | E2E: PATCH late review enqueues; integration on the route handler. |
| REQ-002 | Yes | Yes | Yes | No | Helper unit + route enqueue assertion + e2e enqueue/dispatch. |
| REQ-003 | Yes | Yes | No | No | Helper unit (future channel omitted) + route asserts no enqueue. |
| REQ-004 | Yes | No | No | No | Helper unit: disabled channel / scheduleEnabled=false. |
| REQ-005 | Yes | No | No | No | Helper unit cross-checked against `publishDateForWindow`. |
| REQ-006 | Yes | No | No | No | Helper unit: throwing window → omitted, no throw. |
| REQ-007 | Yes | No | No | No | Existing scheduler unit tests remain green (no diff). |
| REQ-008 | No | Yes | No | No | Route integration: archive with sent timestamp not enqueued. |
| REQ-009 | No | Yes | No | No | Route integration asserts log event emitted. |
| REQ-010 | No | Yes | No | No | Route integration with `processingQueue` undefined → 200, no enqueue. |
| REQ-011 | No | No | Yes | No | E2E: immediate + cron dispatch → single send per channel. |
| EDGE-001 | Yes | No | No | No | Helper unit. |
| EDGE-002 | Yes | No | No | No | Helper unit. |
| EDGE-003 | No | Yes | No | No | Route integration: autoReview archive path unaffected. |
| EDGE-004 | No | No | Yes | No | E2E idempotency. |
| EDGE-005 | Yes | No | No | No | Helper unit boundary. |
| EDGE-006 | No | No | Yes | No | E2E core scenario. |
| EDGE-007 | Yes | Yes | No | No | Helper unit + route enqueue subset assertion. |
| EDGE-008 | Yes | No | No | No | Helper unit. |
| EDGE-009 | Yes | No | No | No | Helper unit. |
| EDGE-010 | Yes | No | No | No | Helper unit. |
| EDGE-011 | Yes | No | No | No | Helper unit (day-rollover). |

## Verification Scenarios

(No library-probe VS-0 scenarios — pure-internal feature, library-probe verdict
NOT_APPLICABLE.)

- **VS-1 (E2E, REQ-002/REQ-006):** Seed a reviewed-transition via PATCH where the run
  `completedAt` is in the past and a channel's `channelTime` is earlier than `now` in the
  schedule timezone. Assert the channel's publish job is enqueued with `{ runId }` and
  `delay: 0`. Run against live DB + Redis (`pnpm infra:up`).
- **VS-2 (E2E, REQ-011/EDGE-004):** After the immediate enqueue marks a channel sent,
  dispatch the equivalent cron job (`{ }` payload, `findLatestTerminal`) and assert the
  worker skips (no second send). Assert exactly one send per channel.
- **VS-3 (Unit, REQ-005):** For a fixed `completedAt`/timezone, assert
  `selectImmediatePublishChannels` past-due decision matches a direct `publishDateForWindow`
  computation for each channel time.

## Out of Scope

- Changing the daily cron mechanism or replacing it with delayed per-run jobs (Approach B,
  explicitly rejected).
- The `autoReview = true` path (archives reviewed at pipeline-finish are published by cron;
  the immediate path triggers only on the manual review-save endpoint).
- Adding force-post endpoints for LinkedIn/Twitter (the immediate trigger is the review
  save, not new manual buttons).
- Any schema/migration change (`run_archives`, `user_settings` unchanged).
- Changing worker publish logic, message composition, link comment/reply behavior, or
  Slack notifications.
- Backfilling or re-publishing historical archives.
- Per-channel `published_at`-style persisted columns (the per-channel moment is computed
  on demand, not stored).
