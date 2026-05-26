# Late-Review Publish Trigger

**Final verification verdict:** ✅ PASSED — see [verification/proof-report.md](verification/proof-report.md)
**Quality gate:** ✅ PASS (9/9 checks)
**Code review:** ✅ APPROVE (2-pass)
**Library probe:** NOT_APPLICABLE — pure-internal feature, no external dependencies

## Summary

When the admin reviews a newsletter **after** a channel's scheduled publish time has
already passed, that channel now publishes **immediately** on review save instead of being
silently dropped for the day. Channels whose scheduled time is still in the future continue
to publish via their existing daily cron — so an on-time review publishes at the scheduled
time, and a late review publishes right away, per channel.

The change is two pieces: a pure decision helper `selectImmediatePublishChannels` in
`@newsletter/shared/scheduling` (returns the enabled, past-due channels for a run; never
throws), and an enqueue side-effect on the `PATCH /api/admin/archives/:runId` review-save
route that fires `delay: 0` runId-targeted publish jobs for those channels. No schema
change, no new dependency, no pipeline-worker change. Double-publish is prevented by the
workers' existing idempotency on `emailSentAt`/`linkedinPostedAt`/`twitterPostedAt` plus a
redundant route-level pre-check.

## Reviewer Index

| Artifact | Purpose |
|----------|---------|
| [spec.md](spec.md) | EARS requirements (REQ-001..011), edge cases (EDGE-001..011), verification matrix |
| [plan.md](plan.md) | Two-phase implementation plan + phase graph + codebase context |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify gate output (the verdict) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Step-5 try-to-break pass: 8 scenarios attempted, all held |

> The `design.md` and `library-probe.md` working artifacts are produced by the pipeline
> but kept out of git by the repo's `.gitignore` spec-allowlist policy (only `spec.md`,
> `plan.md`, `README.md`, `verification/`, and `learnings.md` are committed under
> `docs/spec/`). The design's chosen approach and the NOT_APPLICABLE library-probe verdict
> are summarized above and in `spec.md`.

## What changed (production code)

- `packages/shared/src/scheduling/immediate-publish.ts` — new pure
  `selectImmediatePublishChannels({ settings, completedAt, now }) => PublishChannel[]`.
- `packages/shared/src/scheduling/index.ts` — re-export the helper.
- `packages/api/src/routes/archives.ts` — `PATCH /:runId` enqueues immediate publish jobs
  for past-due enabled channels after a successful review save.

## Behavior matrix

| Review timing | Channel state | Outcome |
|---------------|---------------|---------|
| Before scheduled time | enabled | Deferred to daily cron (publishes at scheduled time) |
| After scheduled time | enabled, not yet sent | Enqueued immediately (`delay: 0`, runId-targeted) |
| After scheduled time | already sent | Skipped (no double-publish) |
| Any | disabled / `scheduleEnabled=false` | Never enqueued |
| Any | malformed time / `channelTime === pipelineTime` | Omitted, no error |

## PR

https://github.com/vertexcover-io/ai-news-aggregator/pull/207
