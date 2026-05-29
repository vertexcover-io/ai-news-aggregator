# Implementation Plan: Email Rate-Limit Hardening + Per-Recipient Retry

**Spec:** docs/spec/email-rate-limit-retry/spec.md
**Branch:** fix/email-rate-limit-retry

## Strategy

Single coherent change to the pipeline package + one shared type. Small enough for one
phase, but split into two ordered steps so the provider-error contract lands before the
retry logic that consumes it. TDD throughout: failing unit test first, then implement.

No DB / route / UI changes → no e2e or Playwright. Existing email-send unit + e2e seam
suites must regress green (REQ-013, REQ-015).

## Phase graph

```dot
digraph plan {
  rankdir=LR
  "phase-1" [label="Phase 1: Typed provider error + retryAfter parsing"]
  "phase-2" [label="Phase 2: Shared pacer (3/s, env) + per-recipient retry + concurrency"]
  "phase-1" -> "phase-2"
}
```

Two phases, serial (phase-2 consumes the typed error from phase-1). Each is small;
single-agent per phase (no step sub-graph).

---

## Phase 1 — Typed provider error + retry-after parsing

**Covers:** REQ-012, REQ-013, VS-0.1, VS-0.2, EDGE-002, EDGE-003, EDGE-006

**Files:**
- `packages/shared/src/types/index.ts` — add an exported `EmailSendError` shape. Define a
  class (or typed Error) carrying: `name` (the provider error code string, e.g.
  `rate_limit_exceeded`), `retryAfterMs?: number | null`, and a `retryable: boolean` flag
  derived from the code. Keep `message` human-readable (unchanged text). Export a helper
  `parseRetryAfter(headerValue: string | undefined | null): number | null` (delta-seconds
  integer → ms; HTTP-date → ms-from-now; `<=0` → 0; unparseable → null) and a
  `RETRYABLE_RESEND_CODES` set. Place near `EmailProvider`.
- `packages/pipeline/src/lib/email-provider.ts` — in `createResendProvider`, when
  `result.error !== null`, throw an `EmailSendError` built from `result.error.name`,
  `result.error.message`, and `parseRetryAfter(result.headers?.['retry-after'])`. The
  destructure must now also read `result.headers` (probe correction: retry-after is on
  `result.headers`, NOT `result.error`). SES provider path unchanged (still throws generic
  Error → `retryable=false` by name, network heuristic handled in phase 2).
- `packages/shared/src/types/index.ts` is exported via `@newsletter/shared` — confirm the
  pipeline subpath import works (`@newsletter/shared` types already imported in email-send.ts).

**Tests (write first):**
- `packages/pipeline/tests/unit/lib/email-provider.test.ts` (new or extend):
  - VS-0.1: fake Resend client returns `{error:{name:'rate_limit_exceeded',message,statusCode:429}, headers:{'retry-after':'2'}}` → wrapper throws `EmailSendError` with `name==='rate_limit_exceeded'`, `retryAfterMs===2000`, `retryable===true`, `message` preserved.
  - VS-0.2: `application_error`, `internal_server_error` → `retryable===true`; `validation_error` → `retryable===false`.
  - EDGE-002: `retry-after` HTTP-date → positive ms; garbage → `retryAfterMs===null`.
  - EDGE-003: `retry-after: '0'` / `'-5'` → `retryAfterMs===0`.
- `packages/shared` unit test for `parseRetryAfter` + `RETRYABLE_RESEND_CODES` table (covers REQ-012 boundary).

**Claims:** write `.harness/email-rate-limit-retry/phase-1-claims.json` (executed>0, failed=0; no UI).

---

## Phase 2 — Shared pacer (default 3/s, env override) + per-recipient retry + worker concurrency

**Covers:** REQ-001..REQ-011, REQ-014, REQ-015, EDGE-001, EDGE-004, EDGE-005, EDGE-007, EDGE-008

**Files:**
- `packages/pipeline/src/workers/email-send.ts`:
  1. Replace `SEND_RATE_PER_SECOND = 5` with a default `DEFAULT_SEND_RATE_PER_SECOND = 3`
     and a `resolveSendRate(env)` helper reading `EMAIL_SEND_RATE_PER_SECOND` (positive int
     → use; else default). (REQ-003, REQ-004, REQ-005)
  2. Add a module-level lazily-initialized shared pacer:
     `let sharedPacer: SendPacer | null = null; function getSharedPacer(): SendPacer {...}`
     created once at the resolved rate. (REQ-002)
  3. In `handleEmailSendJob`, change `const pacer = deps.sendPacer ?? createSendPacer(...)`
     to `deps.sendPacer ?? getSharedPacer()` — keeps the test injection seam. (REQ-002)
  4. Extract the per-recipient send into a retry wrapper `sendWithRetry(subscriber, ...)`
     that: acquires the pacer, calls `emailProvider.send`; on throw, classifies retryable
     (via `EmailSendError.retryable`, plus a network/timeout heuristic for non-typed errors);
     if retryable AND attempts remaining (<2 total): compute delay = `retryAfterMs ??
     exponentialBackoff(attempt)` (1000, 2000), `await sleep(delay)`, `await pacer.acquire()`
     again, retry; else rethrow. Non-retryable → rethrow immediately. (REQ-006..REQ-011)
  5. Inject `sleep` via deps (default `delay` from `@pipeline/lib/delay`) so tests use a
     fake clock — add optional `sleep?: (ms:number)=>Promise<void>` to `EmailSendDeps`.
  6. The existing catch block that counts `failed` + classifies stays — it now runs only
     after retries are exhausted, so a recipient is counted `failed` exactly once. (REQ-011)
- `packages/pipeline/src/workers/processing.ts`:
  - `concurrency: 1` was NOT added (removed in code review: the processing worker serves all
    job types — run-process, email-send, linkedin-post, twitter-post, social-health — and
    concurrency: 1 would serialize all of them behind a long-running run-process, delaying
    email delivery and social posts). The shared module-level pacer provides the email rate
    guarantee instead. (REQ-014 updated accordingly)
- `.env.example` — add `EMAIL_SEND_RATE_PER_SECOND=3` with a comment. (REQ-004)
- `.env` (local) + prod `/etc/newsletter/.env` — NOT committed; note in plan that prod
  needs no change (default 3 applies when unset). Flag for the operator in the PR/README.

**Tests (write first), in `packages/pipeline/tests/unit/workers/email-send.test.ts`:**
- REQ-002/EDGE-001: two sequential `handleEmailSendJob` runs sharing the default pacer →
  `acquire` spacing continuous across both (spy on shared pacer; assert second job doesn't reset).
- REQ-003/004/005: `resolveSendRate` table (default 3; env 2; invalid → 3).
- REQ-006: send throws retryable once then resolves → recipient `sent`, `send` called 2×,
  one `email_sends` row.
- REQ-007: retryable error with `retryAfterMs=1500` → fake sleep observes ≥1500.
- REQ-008: retryable error with no retryAfter → fake sleep observes 1000 (then success/fail).
- REQ-009: non-retryable error → `send` called 1×, recipient `failed`.
- REQ-010: count `pacer.acquire` calls === total send attempts.
- REQ-011/EDGE-005: always-throwing retryable → `failed` counted once, reason in
  `notifyEmailDelivery` payload, `send` called exactly 2×.
- EDGE-007: retry-then-succeed creates exactly one `email_sends` row (no dup from attempt 1).
- REQ-015 regression: existing broadcast/targeted tests unchanged & green.
- REQ-014: assert the worker is constructed with `concurrency: 1` (read option in a small test or via the worker factory).

**Claims:** write `.harness/email-rate-limit-retry/phase-2-claims.json` (executed>0, failed=0; no UI).

---

## Verification (Stage 5)

- Unit: full `pnpm --filter @newsletter/pipeline test:unit` + `@newsletter/shared` green.
- Regression: existing email-send e2e seam tests green.
- Quality gate: typecheck, lint, build, no `any`/`@ts-ignore`.
- Functional-verify: no UI claims; API/DB/worker claims are COVERED_BY_E2E/unit — the
  proof is the unit suite exercising injected clock/sleep + fake provider (documented in
  proof-report). No Playwright needed (no UI surface — explicitly noted in spec).

## Risks
- Worker `concurrency:1` could throttle unrelated job types if one worker serves all jobs.
  Mitigation: it already behaves serially; if any regression risk surfaces in review,
  fall back to "shared pacer only" (the pacer alone already prevents the burst) and drop
  the concurrency change. Decision deferred to code review.
