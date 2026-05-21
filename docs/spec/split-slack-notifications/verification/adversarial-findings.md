# Adversarial Findings — split-slack-notifications

**Date:** 2026-05-21

This is the Step-5 role-swap pass: scenarios attempted to **break** the feature
post-implementation, and the defects surfaced. The two-pass code review already
caught and fixed two Important defects; this report documents the broader
attempt to invalidate the feature beyond the requirements coverage.

## Attempted attacks

### A1 — Promise drift: "as soon as ranking is done"

**Hypothesis:** The user's verbatim wording was "as soon as the pipeline is
done ranking the items we must receive a Slack message about the source
distribution." Could the implementation be technically correct yet drift in
timing — e.g. fire AFTER review-pending instead of before?

**Test:** Read `run-process.ts` around the call site (line ~778). The
`notifySourceDistribution` call appears AFTER the archive `upsert` and
`persistCost()` (necessary, because `markNotification` requires the row to
exist per `partial-update-db-writers-precondition.md`), but BEFORE the
`notifyReviewPending` call. Order:

```
archive.upsert → persistCost → notifySourceDistribution → notifyReviewPending
```

**Verdict:** Correct ordering. Source-distribution arrives in Slack
before review-pending, matching the user's "as soon as" intent (the unavoidable
delay being the archive write itself, which is sub-second).

### A2 — Promise drift: "once the status of the newsletter gets to reviewed"

**Hypothesis:** The user said the email-sent message should fire "once the
status of the newsletter gets to reviewed -> Another slack message should be
received carrying the details of emails sent (as per the schedule)." Could
the email-delivery message fire before the archive is reviewed?

**Test:** Walked the `email-send` job dispatch chain backward.
`archives.ts:205` enqueues `email-send` only via the force-send admin route;
`scheduler.ts:16` schedules `email-send` via the cron + review-completion
trigger. Both paths require the archive to be reviewed (or force-sent by
admin).

**Verdict:** Correct. The email-delivery Slack message cannot fire before the
archive is in a reviewed-or-force-sent state because the `email-send` job
itself cannot fire before then.

### A3 — Race condition: linkedin-post + twitter-post writing notification_state simultaneously

**Hypothesis:** The two per-channel social workers run as independent BullMQ
jobs and may execute nearly concurrently. Two writes to
`run_archives.notification_state` JSONB could lose data via read-modify-write
race.

**Test:** Read `markNotification` implementation in
`packages/pipeline/src/repositories/run-archives.ts` and
`packages/api/src/repositories/run-archives.ts`. The writer uses PostgreSQL's
atomic `notification_state || jsonb_build_object($key, $now)` merge in a single
UPDATE statement — no application-level read-modify-write. Distinct keys
written by distinct workers cannot collide.

**Verdict:** Concurrent-safe.

### A4 — Headline-null edge case

**Hypothesis:** `archive.digestHeadline` can be null (legacy archives or runs
where the ranker failed to produce a digest). Do the four new builders crash?

**Test:** Read each of the four new builder files in
`packages/shared/src/slack/builders/`. Each accepts `headline: string | null`
and conditionally renders the headline section only when `headline !== null &&
headline.length > 0`. The header, telemetry/delivery/permalink, and context
blocks still render — message remains useful without the headline.

**Verdict:** No crash. Spec EC-2 satisfied.

### A5 — failureReasons rendering: provider error format

**Hypothesis:** What if `classifyDeliveryFailure` returns an unusually long
classified string, or what if `failureReasons` is empty?

**Test:** Read `email-delivery.ts` builder. Empty `failureReasons` → the
`◦` bullet block is suppressed (renders only the `Sent to X/Y subscribers
(Z failed)` line). Long classified labels → `truncate(s, 120)` enforces the
existing `ERROR_MESSAGE_MAX_LEN` cap. Pass-2 fixed a separate but related
defect: the map was keyed by raw provider message rather than classified
label.

**Verdict:** Robust.

### A6 — Slack rate-limiting under burst

**Hypothesis:** A single run produces up to **4** Slack POSTs across rank +
email + linkedin + twitter. Could they burst beyond Slack's ~1 msg/sec
incoming-webhook limit?

**Test:** Read the four worker dispatch paths. Each worker is a distinct
BullMQ job:
- `run-process` (long-running, minutes)
- `email-send` (scheduled, typically minutes after run completes)
- `linkedin-post` (independent schedule)
- `twitter-post` (independent schedule)

Even in the worst case where all four schedules align, each Slack call is on
a separate job execution, with BullMQ's job-pickup interval (sub-second to
seconds) as natural spacing. No burst risk.

**Verdict:** No realistic risk. Documented in spec EC-7.

### A7 — Webhook 429 / 500 behavior

**Hypothesis:** What if Slack returns 429 (rate-limited) or 500 mid-run?
Does the worker retry, fail the job, or silently drop the message?

**Test:** Read `notifier.ts` `notifyWithMarker` and the bespoke
`notifySourceDistribution` paths. On non-2xx: log `slack.<event>.failed` at
warn level with status + truncated response body; do NOT write
`markNotification`; do NOT throw. The surrounding worker continues.

**Implication:** On a transient 5xx, the next worker re-attempt (or
the next time the same code path is reached) will re-fire, because the
idempotency key was not written. This is at-most-once on Slack's side but
at-least-once on retry, which is acceptable for ops notifications.

**Verdict:** Acceptable. Spec REQ-011 explicitly covers this.

### A8 — Legacy newsletter-send.ts still wired?

**Hypothesis:** What if the legacy worker is silently still being dispatched
and now fires the combined `notifyNewsletterSent` AND the new
`notifyEmailDelivery` (double notification)?

**Test:** Grep for `case "send-newsletter"` in
`packages/pipeline/src/workers/processing.ts`. Result: zero matches. The
dispatcher only routes: `run-process`, `daily-run`, `pipeline-run`,
`email-send`, `linkedin-post`, `twitter-post`, `social-health`. The legacy
`send-newsletter` job name is not on the active dispatch table; the file
exists as dead code.

**Verdict:** No double notification possible.

### A9 — Test-stub completeness

**Hypothesis:** Test stubs for `SlackNotifier` might be using `Partial<>` or
`as` casts, hiding missing method declarations.

**Test:** Grep for `SlackNotifier` under `packages/pipeline/tests/unit/`.
Each stub is a literal object with all 9 methods (5 existing + 4 new) as
`vi.fn()`. No `Partial`, no `as`, no `@ts-ignore`. Pass-1 review verified
this.

**Verdict:** Stubs are typed against the full interface.

### A10 — JSONB partial-update on missing archive

**Hypothesis:** Per `partial-update-db-writers-precondition.md`, partial
UPDATEs against a missing archive row silently no-op. Could
`markNotification` be called against a missing archive?

**Test:**
- `notifySourceDistribution` is gated on `archiveWritten === true` (the
  `archive.upsert` succeeded just above).
- `notifyEmailDelivery` (in `email-send`): the worker early-returns if
  `archiveRepo.findById(runId)` returns null.
- `notifyLinkedinPosted` / `notifyTwitterPosted`: same pattern in
  `linkedin-post` / `twitter-post`.
- `notifyWithMarker` itself fetches the archive at the top and returns
  early-with-log on null.

**Verdict:** No silent-no-op risk.

## Defects raised

- **A1–A10**: no new defects.
- The two Important defects (VS-3b coverage, `failureReasonCounts` keying)
  are already fixed in code review pass-1 and pass-2.

## Pass-1 suggestions revisited

1. **VS-14 type-level test**: deferred. Implicit tsc enforcement is real —
   adding `sourceDistribution`-typo'd strings to `markNotification` calls
   does fail typecheck (verified).
2. **`notifySourceDistribution` not delegating to `notifyWithMarker`**:
   justified by the upfront null-telemetry skip path. Refactoring
   `notifyWithMarker` to accept a generic `skipPredicate` would be a
   speculative abstraction for one call site.
3. **markNotification failure after 2xx webhook**: at-least-once is acceptable
   for ops notifications. A retry will re-post; the operator might see two
   identical messages — annoying but not incorrect.

## Conclusion

No new defects beyond those caught and fixed in review. Feature is
production-ready per the spec.
