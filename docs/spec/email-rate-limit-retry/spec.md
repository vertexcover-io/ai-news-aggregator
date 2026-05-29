# SPEC: Email Send Rate-Limit Hardening + Per-Recipient Retry

**Source:** docs/spec/email-rate-limit-retry/design.md
**Probe:** docs/spec/email-rate-limit-retry/library-probe.md
**Generated:** 2026-05-29

## Summary

Harden the `email-send` worker so Resend's rate limit (HTTP 429) is never hit: (a) pace
all sends at a configurable target (default 3 req/s) shared across every `email-send` job
invocation, and (b) retry each individual failed send at least once on retryable errors,
honoring the Resend `retry-after` header, while failing fast on permanent errors.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The system shall pace email sends so that no more than the configured rate of `send` calls start in any rolling one-second window. | With rate=R, the minimum spacing between two consecutive `pacer.acquire()` returns is `ceil(1000/R)` ms (existing `createSendPacer` invariant), asserted by unit test. | Must |
| REQ-002 | Ubiquitous | The send pacer shall be shared across all `email-send` job invocations within the worker process (a single module-scoped instance), not reconstructed per job. | Two sequential `handleEmailSendJob` calls using the default pacer observe continuous spacing — the second job does NOT reset `nextAvailableAt` to 0. Unit test: spy on a shared pacer used by two job runs; total `send` starts across both jobs respect the spacing. | Must |
| REQ-003 | Ubiquitous | The default send rate shall be 3 requests per second. | With no env override, the resolved rate is 3 → spacing 334 ms. Unit test asserts default. | Must |
| REQ-004 | Event-driven | When `EMAIL_SEND_RATE_PER_SECOND` is set to a valid positive integer, the system shall use it as the send rate. | `EMAIL_SEND_RATE_PER_SECOND=2` → resolved rate 2 (spacing 500 ms). Unit test with env stub. | Must |
| REQ-005 | Unwanted | If `EMAIL_SEND_RATE_PER_SECOND` is unset, non-numeric, zero, or negative, then the system shall fall back to the default rate of 3. | Inputs `""`, `"abc"`, `"0"`, `"-1"` all resolve to 3. Unit test (table). | Must |
| REQ-006 | Event-driven | When an individual recipient send fails with a retryable error, the system shall retry that send up to a maximum of 2 total attempts. | A send that throws retryable once then succeeds → recipient counted `sent`, exactly one `email_sends` row, `emailProvider.send` called twice for that recipient. Unit test. | Must |
| REQ-007 | Event-driven | When a retryable send error carries a `retry-after` value, the system shall wait at least that duration before the retry. | Provider error with `retryAfterMs=1500` → the retry path sleeps ≥1500 ms (injected clock/sleep spy observes the value). Unit test with fake sleep. | Must |
| REQ-008 | Unwanted | If a retryable send error carries no usable `retry-after`, then the system shall back off exponentially (attempt 1 → 1000 ms, attempt 2 → 2000 ms) before retrying. | Provider error without retryAfter → injected sleep observes 1000 ms before the single retry. Unit test. | Must |
| REQ-009 | Unwanted | If an individual recipient send fails with a non-retryable error, then the system shall not retry it and shall count it as failed. | Provider throws `validation_error` / invalid-address → `emailProvider.send` called once, recipient counted `failed`, classified reason recorded. Unit test. | Must |
| REQ-010 | Event-driven | When a recipient send is retried before re-sending, the system shall re-acquire the pacer permit so retries are themselves rate-paced. | The retry path calls `pacer.acquire()` again before the second `emailProvider.send`. Unit test counts `acquire` calls = total send attempts. | Must |
| REQ-011 | Unwanted | If a recipient send still fails after its final retry, then the system shall count it as failed exactly once and include its classified reason in the delivery summary. | Always-throwing retryable error → recipient counted `failed` once (not per attempt); `failureReasons` includes its reason; `notifyEmailDelivery` receives `failed≥1`. Unit test. | Must |
| REQ-012 | Ubiquitous | The Resend provider wrapper shall surface the error code (`result.error.name`) and the `retry-after` header (`result.headers['retry-after']`) on the thrown error. | The wrapper throws an error object exposing `name` (e.g. `rate_limit_exceeded`) and `retryAfterMs` (parsed from header) while preserving the existing `message` text. Unit test with a fake Resend client returning `{error:{name,message,statusCode}, headers:{'retry-after':'2'}}`. | Must |
| REQ-013 | Ubiquitous | The existing string-based `classifyDeliveryFailure(message)` behavior shall be preserved for the Slack summary. | All pre-existing classify tests still pass; the typed error's `message` is unchanged so classification output is identical. Regression: existing suite green. | Must |
| REQ-014 | State-driven | While the processing worker handles email-send jobs, no two `email-send` jobs shall burst past the rate ceiling concurrently. | Guaranteed by the shared module-level pacer (single-flight via shared pacer across all same-process jobs). Worker-level `concurrency: 1` was removed in code review because it would serialize all job types (run-process, linkedin-post, twitter-post) behind a long-running email-send; the pacer alone is the correct guard. Verified by test asserting `concurrency` is NOT 1 (the wrong tool) and by REQ-002 asserting shared pacer continuity across job runs. | Should |
| REQ-015 | Ubiquitous | The broadcast-vs-targeted send semantics established in commit 60d748b shall remain unchanged. | Existing broadcast/targeted tests still pass; `markEmailSent`/`notifyEmailDelivery` still broadcast-only. Regression. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Two `email-send` jobs run back-to-back in the same second (welcome-send then broadcast). | Combined `send` starts never exceed the rate in any rolling second — the shared pacer carries `nextAvailableAt` across both. | REQ-001, REQ-002 |
| EDGE-002 | `retry-after` header is an HTTP-date string instead of a delta-seconds integer. | Parsed to a non-negative ms delay; if unparseable, fall back to exponential backoff (treated as "no usable retry-after"). | REQ-007, REQ-008 |
| EDGE-003 | `retry-after` is `"0"` or negative. | Clamp to 0 ms (retry immediately, still pacer-gated). | REQ-007 |
| EDGE-004 | A wave of many recipients all 429 at once, then recover. | Each retries (≤2 attempts), paced; job completes; recovered recipients counted `sent`, still-failing counted `failed` once each. | REQ-006, REQ-010, REQ-011 |
| EDGE-005 | Retryable error on the final (2nd) attempt. | Counted `failed` once, reason recorded, no third attempt. | REQ-006, REQ-011 |
| EDGE-006 | SES provider path throws an AWS error with no Resend `name`. | Unknown `name` → not classified retryable by name; network/timeout heuristic may still retry, otherwise fail fast. Does not crash. | REQ-009, REQ-012 |
| EDGE-007 | A retried send succeeds on attempt 2. | Exactly one `email_sends` row created (no duplicate from attempt 1, which threw before the create). | REQ-006, NFR2 |
| EDGE-008 | `EMAIL_SEND_RATE_PER_SECOND` set above the account limit (e.g. 50). | Honored as-is (operator's responsibility); no clamp. Documented. Default path (3) unaffected. | REQ-004 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Existing pacer spacing invariant. |
| REQ-002 | Yes | No | No | No | Shared module pacer across two job runs. |
| REQ-003 | Yes | No | No | No | Default rate = 3. |
| REQ-004 | Yes | No | No | No | Env override. |
| REQ-005 | Yes | No | No | No | Invalid env → default (table). |
| REQ-006 | Yes | No | No | No | Retry-once-then-succeed. |
| REQ-007 | Yes | No | No | No | Honor retry-after via injected sleep spy. |
| REQ-008 | Yes | No | No | No | Exponential backoff via injected sleep spy. |
| REQ-009 | Yes | No | No | No | Non-retryable → no retry. |
| REQ-010 | Yes | No | No | No | acquire() called per attempt. |
| REQ-011 | Yes | No | No | No | Failed counted once, reason in summary. |
| REQ-012 | Yes | No | No | No | Provider wrapper surfaces name + retryAfterMs. |
| REQ-013 | Yes | No | No | No | Existing classify tests regress green. |
| REQ-014 | Yes | No | No | No | Assert that concurrency is NOT 1 (wrong tool) + REQ-002 shared pacer is the rate guard. |
| REQ-015 | Yes | No | No | No | Existing broadcast/targeted suite regresses green. |
| EDGE-001..008 | Yes | No | No | No | All covered by unit tests with injected clock/sleep + fake provider. |

**No new DB schema, no HTTP route, no UI surface** → no integration/e2e/Playwright tests
required. This is a pure worker-logic + provider-wrapper change; unit tests with injected
clock/sleep and a fake `EmailProvider` fully cover behavior. The existing e2e seam tests for
email-send must continue to pass (regression only).

## Verification Scenarios (from probe — VS-0)

- **VS-0.1 (resend error shape):** A fake Resend client returning
  `{ data:null, error:{ name:'rate_limit_exceeded', message:'Too many requests', statusCode:429 }, headers:{ 'retry-after':'2' } }`
  → the provider wrapper throws an error with `name==='rate_limit_exceeded'` and
  `retryAfterMs===2000`, and `message` contains the original text.
- **VS-0.2 (retryable codes):** `application_error` and `internal_server_error` are also
  classified retryable; `validation_error` is not.

## Out of Scope

- Resend `batch.send` API migration (Approach B) — deferred unless list grows to thousands.
- Redis-backed / multi-instance distributed rate limiting (Approach C) — prod is single-instance.
- Retrying the BullMQ job as a whole (`attempts`/`backoff` at the queue level) — per-recipient retry is the correct granularity.
- Changing SES throttle/retry semantics beyond not-breaking it — prod is Resend.
- Backfilling/re-sending the historical 8e79b229 run — already handled manually.
- Persisting failed recipients for a later automatic re-send across job runs (the in-job retry + existing `email_sends` dedup is the agreed bound).
