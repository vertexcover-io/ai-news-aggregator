# SPEC — Cap newsletter send rate to 5/sec; surface raw provider error

**Branch:** `feat/slack-notify-on-reviewed` (follow-up commit on the in-flight Slack PR)
**Worktree:** `/Users/amankumar/Documents/newsletter/.worktrees/feat-slack-notify`

## Problem

Two concrete issues observed in the live AUTO_REVIEW run (`cebac2c6-...`):

1. **Resend rate-limit floods the failure list.** The free-tier Resend plan caps requests at **5/sec**. Our send worker fires `Promise.allSettled` over an entire batch of 50 subscribers in parallel, so 32+ requests hit Resend within ~100 ms and 32 of them come back rejected with `Too many requests`. That's not a real send failure — it's our own pacing problem.

2. **Slack failure-reasons are too abstracted.** The classifier collapses every Resend error into short labels like `"rate limit"` or `"unverified sender domain"`. Operators want the *actual* string the provider returned so they can debug without grepping the structured logs.

## Scope

**In scope:**
- Limit outgoing emails to **≤ 5 per second** in `packages/pipeline/src/workers/newsletter-send.ts`. Implementation should be a token-bucket / fixed-rate scheduler — not just a per-batch sleep, since the BATCH_SIZE is 50 (any naive batch sleep would still burst).
- Replace the classified `reason` label fed to the Slack notifier with the **raw provider error message** (truncated to keep the message readable).
- Keep the per-failure structured log (`event: "newsletter-send.failed"`) carrying both the raw `error` and the classified `reason` — those two fields aid log analysis and we don't want to lose them.

**Out of scope:**
- Configurable rate (5/sec is hardcoded, matching Resend free-tier; if the user upgrades they can tune it later).
- Retrying rate-limited sends. (At 5/sec we should never trip the limit. If we still do, that's a real issue worth surfacing rather than silently retrying.)
- Switching email providers.

## Functional Requirements

### FR-1. Rate limit at 5 sends/second

The send worker MUST emit `emailProvider.send` calls at a rate of at most 5 per second across the **entire send job**, not per batch. This means:

- A 38-recipient run takes ≥ ~7.6 seconds end-to-end (38 / 5 = 7.6s) instead of finishing in <1s.
- The implementation must NOT introduce serial blocking that prevents `Promise.allSettled` from observing all results — failures and successes must still be aggregated correctly.

The 5/sec cap MUST be a named constant `SEND_RATE_PER_SECOND = 5` near the top of `newsletter-send.ts`.

### FR-2. Raw provider error in Slack failure breakdown

`DeliveryFailureReason.reason` (passed to the notifier) MUST contain the raw error string the provider returned (e.g. `"Resend error: Too many requests..."`) — NOT the classified label.

The aggregation key for grouping identical failures is **also the raw string**. Two recipients that fail with byte-identical Resend errors collapse into one row with `count: 2`; recipients that fail with subtly different messages stay as separate rows.

The structured log line `event: "newsletter-send.failed"` MUST keep:
- `error`: raw provider message (already there).
- `reason`: classified short label (already there from the prior change — kept for log queries).

The `classifyDeliveryFailure` helper continues to exist and produce the structured-log `reason` field. It is no longer used to build the Slack `DeliveryFailureReason.reason` value.

### FR-3. Truncation

The message-builder already truncates the displayed reason to 120 chars with an ellipsis (`truncate(...)`). That logic stays — raw Resend errors can be 200+ chars, so we'd otherwise blow up the Slack section.

## Non-Functional Requirements

- No new dependencies. Use a tiny in-file rate limiter (token bucket or a Promise queue with `setTimeout`).
- The rate limiter must be testable: accept an injectable `now` and `sleep` so tests can verify pacing without real timers.
- Existing unit tests must continue to pass with timing tweaks where necessary.

## Verification Scenarios

### VS-1 — Rate cap enforced

**Given** 12 confirmed subscribers and `SEND_RATE_PER_SECOND = 5`.
**When** the send worker processes the job with a `now`+`sleep` that records call timestamps.
**Then** at most 5 `emailProvider.send` invocations occur within any 1000 ms window.

### VS-2 — Counts unchanged

**Given** mixed success / failure responses across many subscribers.
**When** the send worker completes.
**Then** `attempted`, `sent`, and `failed` counters report the same values they would without the rate limiter (only the *time* changes, not the *outcome*).

### VS-3 — Raw provider error reaches Slack

**Given** 3 subscribers, all failing with `"Resend error: Too many requests. You can only make 5 requests per second…"` (byte-identical message).
**When** the worker calls `slackNotifier.notifyNewsletterSent`.
**Then** the `delivery.failureReasons` array contains exactly one entry with `count: 3` and `reason` equal to the verbatim Resend string.

### VS-4 — Distinct provider errors stay distinct

**Given** 2 subscribers fail with the rate-limit string and 1 fails with `"Resend error: The vertexcover.io domain is not verified..."`.
**When** the worker calls the notifier.
**Then** `failureReasons` has exactly 2 entries: rate-limit (count 2), unverified-domain (count 1).

### VS-5 — Structured log preserves both fields

**Given** any per-recipient failure.
**When** the worker logs `newsletter-send.failed`.
**Then** the log object has both `error: "<raw message>"` AND `reason: "<classified label>"`.

### VS-6 — Live integration

**Given** AUTO_REVIEW=true and 38 subscribers.
**When** a real run completes.
**Then**:
- Total wall-clock send time ≥ ~7.5 seconds.
- Slack message renders failure reasons as raw provider strings (truncated to 120 chars).
- No `slack.notify.failed` event.

## Acceptance

1. All VS-1..VS-5 scenarios proven by passing unit tests.
2. VS-6 proven by a live AUTO_REVIEW run captured under `docs/spec/cap-send-rate-and-raw-error/verification/`.
3. `pnpm typecheck` and `pnpm lint` pass with zero new errors.
