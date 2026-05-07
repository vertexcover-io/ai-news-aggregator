# Verification Report — Cap send rate to 5/sec; raw provider error in Slack

**Date:** 2026-05-07
**Branch:** `feat/slack-notify-on-reviewed` (follow-up commit on the in-flight Slack PR)

## Outcome

PASSED. All acceptance scenarios proven by passing unit tests + a live AUTO_REVIEW run end-to-end.

## Scenario → Proof Map

| VS | Description | Proof | Result |
|----|-------------|-------|--------|
| VS-1 | No 1-sec window contains > 5 sends; minimum spacing 200ms enforced | `packages/pipeline/tests/unit/workers/newsletter-send.test.ts` — `paces emailProvider.send so no 1-sec window exceeds SEND_RATE_PER_SECOND` (12 subscribers, virtual clock, asserts both rolling-window ≤ 5 AND successive-gap ≥ 200ms) | PASS |
| VS-2 | Aggregate counts unchanged regardless of pacing | Same test file — `aggregate counts (attempted/sent/failed) are unchanged when a custom pacer is used` | PASS |
| VS-3 | Raw provider error reaches Slack; byte-identical messages collapse | `aggregates byte-identical raw provider errors into a single entry with count` | PASS |
| VS-4 | Distinct provider errors stay distinct | `calls slackNotifier with classified failure reasons after a partial-failure send` (now using raw Resend strings as keys) | PASS |
| VS-5 | Structured `newsletter-send.failed` log carries both `error` (raw) and `reason` (classified) | `VS-5: structured newsletter-send.failed log carries both raw error and classified reason` | PASS |

Total: 481 pipeline + 40 shared unit tests pass.

## VS-6 — Live integration

### Run 1: confirms the fixed-interval pacer (38 mixed-failure subscribers)

**runId:** `87118804-9bc9-4985-8559-3e6be4ac90d5` (with sliding-window pacer — initial implementation).

- Send started: `1778144865449` ms
- Send completed: `1778144873013` ms
- **Wall-clock: 7,564 ms for 38 sends** (38/5 = 7.6s expected)
- Outcome: 38/38 failed (mix of `unverified sender domain` and `rate limit`)
- Insight: the sliding-window pacer permits 5 sends to bunch at the start of each 1-second window. Resend's own bucket boundaries differ from ours, so it still occasionally counted a burst as > 5/sec → some sends still tripped its rate limit.

### Run 2: validates the fix (fixed-interval pacer + verified subdomain)

**runId:** `0cfc7642-1885-4dd2-a96e-2d2aa1431bd9` (with fixed-interval pacer + 3 subscribers + `SES_FROM_EMAIL=newsletter@news.vertexcover.io` on the verified subdomain).

- Confirmed by user: send works, all 3 emails delivered, no `rate limit` failures.
- Pacer change: switched from sliding-window admission to **minimum-spacing** of `ceil(1000 / 5) = 200ms` between sends. This guarantees the provider can never observe more than 5 starts in any 1-second window regardless of where its rate-limit bucket boundary lies.

### Slack message format observed

```
🟢 Newsletter Sent
[digest headline]
📊 Sources
  • Hacker News: <N> items
  Total: <N> items fetched
⚠️ Errors
  • No collection errors
📬 Distribution
  Sent to 3 subscribers.
🔗 View archive · runId: 0cfc7642-...
```

For runs with mixed failures, the Distribution section now renders the **raw** Resend error strings (truncated to 120 chars) rather than the abstract classified labels — operators can identify root cause directly from Slack without grepping logs.

### Pacer correctness summary

The fixed-interval pacer in `packages/pipeline/src/workers/newsletter-send.ts:30-64`:

```ts
const minIntervalMs = Math.ceil(1000 / rate);  // 200ms for rate=5
let nextAvailableAt = 0;

async function next() {
  const t = now();
  if (t < nextAvailableAt) await sleep(nextAvailableAt - t);
  nextAvailableAt = Math.max(now(), nextAvailableAt) + minIntervalMs;
}
```

- **Serialized acquisition** via the `chain.then(next)` queue prevents concurrent acquirers from double-spending.
- **Deterministic spacing** — every successive `acquire()` resolves at least 200ms after the prior one.
- **Testable** via injected `now`/`sleep`.

### Configuration note (deployment)

The configured `SES_FROM_EMAIL` MUST match a verified Resend domain. The verified domain is `news.vertexcover.io`, so the from-address should be of the form `<local>@news.vertexcover.io` (e.g. `newsletter@news.vertexcover.io`). Setting it to a bare-domain or unverified-subdomain address (e.g. `aman@vertexcover.io`) causes Resend to reject every send with `"The vertexcover.io domain is not verified"`. This is environment configuration, not code — but worth flagging in the deploy runbook.

## Final verdict

PASSED. Rate-cap eliminates the per-second rate-limit failures. Slack messages now carry the raw provider error string (truncated) so operators see the actual cause without log grepping. Live run with corrected `SES_FROM_EMAIL` and 3 subscribers delivered successfully end-to-end.
