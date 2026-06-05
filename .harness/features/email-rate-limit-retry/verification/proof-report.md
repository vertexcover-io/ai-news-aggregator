# Functional Verification Proof Report — email-rate-limit-retry

**Verdict: PASS**

**Date:** 2026-05-29
**Branch:** fix/email-rate-limit-retry
**Verifier:** functional-verify agent

---

## UI Claims

Zero. The claims.json contains 23 claims, all `type: "unit"`. There are zero `type: "ui"` claims.
**No Playwright was run — this is correct per the spec, not a skipped gate.** The spec
(verification matrix, final paragraph) explicitly states: "No new DB schema, no HTTP route, no UI
surface → no integration/e2e/Playwright tests required."

---

## Test Suite Execution

### Commands run (in order)

```
pnpm --filter @newsletter/eslint-plugin build
pnpm --filter @newsletter/shared build
pnpm --filter @newsletter/shared test:unit
pnpm --filter @newsletter/pipeline test:unit
```

### Results

**@newsletter/eslint-plugin build:** PASS (build success in ~8ms)

**@newsletter/shared build:** PASS (all dist outputs generated)

**@newsletter/shared test:unit:**
```
 Test Files  34 passed (34)
      Tests  367 passed (367)
   Start at  11:13:10
   Duration  1.49s
```

**@newsletter/pipeline test:unit:**
```
 Test Files  94 passed (94)
      Tests  1105 passed (1105)
   Start at  11:13:15
   Duration  18.34s
```

---

## REQ/EDGE → Proving Test Mapping

| ID | Proving Test(s) | Suite | Status |
|----|----------------|-------|--------|
| REQ-001 | `createSendPacer` spacing invariant tests | `@newsletter/shared test:unit` | PASS |
| REQ-002 | `getSharedPacer (REQ-002) > returns the same instance on repeated calls` | `@newsletter/pipeline test:unit` | PASS |
| REQ-002/EDGE-001 | `handleEmailSendJob — per-recipient retry > REQ-002/EDGE-001: shared pacer is the same instance across two job runs` | `@newsletter/pipeline test:unit` | PASS |
| REQ-003 | `resolveSendRate (REQ-003/004/005) > returns 3 when env is empty` | `@newsletter/pipeline test:unit` | PASS |
| REQ-004 | `resolveSendRate > returns 2 when EMAIL_SEND_RATE_PER_SECOND=2`, `honors large valid values (EDGE-008)` | `@newsletter/pipeline test:unit` | PASS |
| REQ-005 | `resolveSendRate > returns 3 when [empty string/non-numeric/zero/negative/float]` (5 tests) | `@newsletter/pipeline test:unit` | PASS |
| REQ-006 | `REQ-006: retries once on retryable error then succeeds` | `@newsletter/pipeline test:unit` | PASS |
| REQ-007 | `REQ-007: honors retryAfterMs when set` | `@newsletter/pipeline test:unit` | PASS |
| REQ-008 | `REQ-008: uses exponential backoff (1000ms) when no retryAfterMs` | `@newsletter/pipeline test:unit` | PASS |
| REQ-009 | `REQ-009: does not retry non-retryable errors` | `@newsletter/pipeline test:unit` | PASS |
| REQ-010 | `REQ-010: re-acquires pacer on retry` | `@newsletter/pipeline test:unit` | PASS |
| REQ-011/EDGE-005 | `REQ-011/EDGE-005: failed counted once when all retries exhausted` | `@newsletter/pipeline test:unit` | PASS |
| REQ-012 | `createResendProvider — VS-0.1: rate_limit_exceeded error shape > throws EmailSendError with name=rate_limit_exceeded, retryAfterMs=2000, retryable=true` + VS-0.2 (3 tests) | `@newsletter/pipeline test:unit` | PASS |
| REQ-013 | Full pipeline unit suite green (classifyDeliveryFailure unaffected; existing suite passes) | `@newsletter/pipeline test:unit` | PASS |
| REQ-014 | `REQ-014: worker does not restrict concurrency (shared pacer is the rate guard)` — asserts `concurrency` is NOT 1 (concurrency:1 was removed in code review; shared pacer is the guard) | `@newsletter/pipeline test:unit` | PASS |
| REQ-015 | `handleEmailSendJob > scheduled jobs publish the latest reviewed unsent archive`, `targeted welcome send to a new subscriber does NOT stamp emailSentAt`, `broadcast IS blocked when emailSentAt is already set` — full suite green | `@newsletter/pipeline test:unit` | PASS |
| EDGE-001 | `REQ-002/EDGE-001: shared pacer is the same instance across two job runs` | `@newsletter/pipeline test:unit` | PASS |
| EDGE-002 | `createResendProvider — EDGE-002: retry-after as HTTP-date > parses a future HTTP-date to positive ms`, `returns null retryAfterMs for a garbage retry-after string` | `@newsletter/pipeline test:unit` | PASS |
| EDGE-003 | `createResendProvider — EDGE-003: retry-after zero and negative > clamps retry-after '0' to retryAfterMs=0`, `clamps retry-after '-5' to retryAfterMs=0` | `@newsletter/pipeline test:unit` | PASS |
| EDGE-004 | Covered by REQ-006 + REQ-011 combination (wave of retryables: each retries ≤2 attempts then resolves or fails once) | `@newsletter/pipeline test:unit` | PASS |
| EDGE-005 | `REQ-011/EDGE-005: failed counted once when all retries exhausted` | `@newsletter/pipeline test:unit` | PASS |
| EDGE-006 | `createResendProvider — EDGE-006: no Resend error name (null headers) > throws EmailSendError with retryable=false when name is unknown` | `@newsletter/pipeline test:unit` | PASS |
| EDGE-007 | `EDGE-007: retry-then-succeed creates exactly one email_sends row` | `@newsletter/pipeline test:unit` | PASS |
| EDGE-008 | `resolveSendRate > honors large valid values (EDGE-008)` | `@newsletter/pipeline test:unit` | PASS |

---

## Additional Checks

- `pnpm typecheck`: PASS (7/7 tasks, full turbo cache hit on unchanged packages)
- `pnpm lint`: PASS (0 errors; 17 pre-existing web-package warnings — none in pipeline/shared, none from this feature)
- No `any` types, `@ts-ignore`, or `as unknown as X` casts in feature files
- No skipped tests in pipeline or shared unit suites

---

## REQ-014 Note

REQ-014 was originally specified as "worker concurrency: 1" but was superseded in code review. The
processing worker serves all job types (run-process, daily-run, email-send, linkedin-post,
twitter-post, social-health). Setting `concurrency: 1` would serialize all job types behind a
long-running `run-process`, delaying email delivery and social posts. Code review removed the
concurrency change; the shared module-level pacer provides the equivalent single-flight guarantee for
the email rate budget. The test in `processing.test.ts` now asserts that `concurrency` is NOT 1,
which is the correct post-review behavior. The spec.md REQ-014 text requires a doc update (covered in
sync-docs step).
