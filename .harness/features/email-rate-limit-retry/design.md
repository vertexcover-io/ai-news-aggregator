# Design: Email Send Rate-Limit Hardening + Per-Recipient Retry

## Problem Statement

The newsletter `email-send` worker hit Resend's rate limit (HTTP 429) during the
2026-05-29 incident recovery: two recipients (`ranjan@vertexcover.io`,
`kosariuday43@gmail.com`) were dropped with `reason: "rate limit"` and never retried —
they only received the issue because the operator manually re-enqueued the job.

Two goals:
1. **Never hit the Resend rate limit again** — keep send throughput comfortably under
   the account limit, including across back-to-back / overlapping jobs.
2. **Retry failed sends at least once** — a transient per-recipient failure (rate limit
   or transient server/network error) must be retried within the job, not silently dropped.

## Context

- Worker: `packages/pipeline/src/workers/email-send.ts` (`handleEmailSendJob`).
- Provider: prod uses **Resend** (`packages/pipeline/src/lib/email-provider.ts` →
  `createResendProvider`; `EMAIL_PROVIDER` unset on prod so it defaults to Resend).
  An SES provider also exists behind the same `EmailProvider` interface.
- Pacer: `createSendPacer(rate)` (fixed-interval, `ceil(1000/rate)` ms spacing).
  Currently `SEND_RATE_PER_SECOND = 5`, constructed **per job** at `email-send.ts:309`.
- BullMQ `Worker` constructed with `{ connection }` only — **concurrency defaults to 1**,
  no `limiter`, no `attempts`/`backoff`. The job loops over recipients in batches of 50
  and sends each via `Promise.allSettled`, catching per-recipient errors and counting
  them as `failed` without any retry.
- The provider wrapper throws `new Error("Resend error: " + message)`, **discarding**
  `error.name` (e.g. `rate_limit_exceeded`) and the `retry-after` header.

### Root causes of the 429

1. **Per-job pacer reset.** Each job builds a fresh pacer with `nextAvailableAt = 0`, so
   two jobs in the same wall-clock second (welcome-send + broadcast, or a manual retry)
   each admit up to `rate` sends immediately → combined burst up to `2 × rate`.
2. **No safety margin.** The pacer targets exactly the account limit (5/s). Clock jitter,
   render time variance, or any overlap pushes it over.
3. **No retry.** A 429'd send is logged and dropped — `email_sends` never gets the row,
   so even the broadcast idempotency can't recover it; only a full manual re-enqueue does.

## Requirements

### Functional
- FR1: The aggregate send rate across **all** `email-send` job invocations stays at or
  below a configured target (default **3 req/s**), even for back-to-back or concurrent jobs.
- FR2: Each individual send that fails with a **retryable** error is retried at least once
  (up to 2 total attempts) within the same job.
- FR3: Retry honors the Resend `retry-after` header when present; otherwise uses
  exponential backoff (1s, 2s).
- FR4: **Non-retryable** errors (invalid address, hard bounce, recipient rejected) fail
  fast — no retry, classified and counted as before.
- FR5: The rate target is configurable via `EMAIL_SEND_RATE_PER_SECOND` (default 3).
- FR6: Post-retry failures remain visible in the existing `notifyEmailDelivery` Slack
  summary (attempted / sent / failed + top reasons) — a recipient is only counted
  `failed` after its retries are exhausted.

### Non-functional
- NFR1: No new external dependencies. Resend SDK + existing pacer only.
- NFR2: Idempotent — per-recipient `email_sends` dedup unchanged; a retried-then-succeeded
  send writes exactly one `email_sends` row.
- NFR3: Single-pipeline-instance correctness is sufficient (prod runs one pipeline
  container). The shared pacer is in-process; multi-instance coordination is out of scope.
- NFR4: The broadcast vs targeted-send semantics fixed in `60d748b` are preserved.

### Edge cases
- EC1: A retryable error on the **last** attempt → counted `failed`, logged, surfaced in Slack.
- EC2: `retry-after` header absent or unparseable → fall back to exponential backoff.
- EC3: Retry backoff sleeps must **also** pass through the pacer on re-send, so a wave of
  retries can't itself burst past the rate ceiling.
- EC4: SES provider path — SES has different throttling semantics; the typed-error change
  must not break SES (SES errors won't carry Resend's `name`/`retryAfter`, so they fall to
  the generic retryable/non-retryable classification or fail fast — acceptable, prod is Resend).
- EC5: The shared module-level pacer is the rate guard for concurrent email-send jobs. Worker-level
  `concurrency: 1` was considered but removed (it would serialize all job types — run-process,
  linkedin-post, twitter-post — behind a long-running email-send). The pacer alone is sufficient
  because all `acquire()` calls from any job in the same process queue on the same promise chain.
- EC6: A single recipient's retry must not block the whole batch unduly — retries run
  within the recipient's own async task inside `Promise.allSettled`, so other recipients
  proceed; the pacer serializes the actual `send` calls.

## Key Insights

- The pacer is already correct **within** a job; the only gap is that it's not shared
  **across** jobs. Promoting it to a module-level singleton (lazily created, keyed by the
  resolved rate) closes the cross-job burst with no Redis needed.
- BullMQ job-level `attempts` does **not** help, because the job swallows per-recipient
  errors and completes "successfully" — BullMQ never sees a failure. Retry must live at
  the **per-recipient** level, inside the send loop.
- The fix to honor `retry-after` requires the provider wrapper to stop flattening the
  error. A small typed error (`name`, optional `retryAfterMs`) threaded through is enough.

## Architectural Challenges

- **Pacer ownership / lifetime.** Move from per-job local to a module-level lazily-initialized
  singleton. Must remain injectable for tests (the existing `deps.sendPacer` seam stays;
  default falls back to the shared singleton instead of a fresh per-job pacer).
- **Error contract across providers.** Introduce a typed send error that the Resend wrapper
  populates (`name` from `result.error.name`, `retryAfterMs` from the 429 `retry-after`
  header). The retry classifier reads these; SES path is unaffected (no name → generic).
- **Backoff inside the rate budget.** The retry path must `await backoff` then
  `await pacer.acquire()` again before re-sending, so retries are themselves paced.

## Approaches Considered

### Approach A — Shared module pacer (rate 3) + in-job per-recipient retry  ✅ chosen
- Promote pacer to a module-level singleton at the chosen rate (default 3, env-overridable).
- Wrap each recipient send in a small retry loop (max 2 attempts) that classifies the error,
  honors `retry-after`, and re-acquires the pacer before re-sending.
- Surface `error.name` + `retry-after` from the Resend wrapper via a typed error.
- Pin worker concurrency to 1 for safety.
- **Trade-off:** in-process only (fine for one pipeline instance); minimal blast radius;
  no provider API change.

### Approach B — Resend `batch.send` (≤100/call)
- Far fewer API calls → rate limit nearly moot.
- **Rejected for now:** per-recipient unsubscribe tokens, HTML, and message-id/`email_sends`
  bookkeeping all differ per email; batch changes the success/failure granularity and the
  dedup model. Much larger change for a problem the pacer already mostly solves. Worth
  revisiting only if the list grows into the thousands.

### Approach C — Redis-backed BullMQ limiter
- Coordinates across multiple worker instances.
- **Rejected:** a job-level limiter doesn't pace per-recipient sends within a single
  looping job, and prod runs a single instance, so the module pacer is sufficient. Adds
  Redis coordination complexity for no current benefit.

## Chosen Approach

Approach A. Concretely:

1. **Rate:** `EMAIL_SEND_RATE_PER_SECOND` env (default **3**). `SEND_RATE_PER_SECOND`
   constant becomes the default fallback.
2. **Shared pacer:** module-level lazily-created singleton at the resolved rate.
   `handleEmailSendJob` uses `deps.sendPacer ?? sharedPacer` instead of building a fresh one.
3. **Typed provider error:** Resend wrapper throws an error carrying `name`
   (`rate_limit_exceeded`, etc.) and `retryAfterMs` (parsed from the 429 `retry-after`
   header when present). SES + generic paths unchanged.
4. **Per-recipient retry:** in the send loop, retry up to 2 attempts on retryable error
   names (`rate_limit_exceeded`, `application_error`, `internal_server_error`) and on
   network/timeout errors; honor `retryAfterMs`, else exponential backoff (1s, 2s);
   re-acquire the pacer before each re-send. Non-retryable → fail fast.
5. **Worker concurrency:** NOT pinned to 1 (removed in code review — it would serialize all job
   types behind email-send). The shared module-level pacer is the sole rate guard. The test
   asserts `concurrency` is NOT 1 and REQ-002/EDGE-001 verifies cross-job pacer continuity.
6. **Slack visibility:** unchanged mechanism — a recipient counts as `failed` only after
   retries are exhausted, so the existing summary already reflects post-retry truth.

## Open Questions
- None blocking. SES throttle semantics are out of scope (prod is Resend); if SES becomes
  primary, revisit EC4 with SES-specific retryable classification.

## Risks and Mitigations
- **R1: Retry storms under a sustained Resend outage.** Mitigation: cap at 2 attempts,
  retryable-only, paced — bounded work; the job completes and Slack surfaces failures.
- **R2: Concurrency-1 slows unrelated jobs (run-process) if they share the worker.**
  Mitigation: verify whether a single worker handles all job types; if so, prefer the
  shared module pacer + assert email single-flight rather than globally throttling the
  worker. (Resolve in planning by reading the worker construction.)
- **R3: Typed error change breaks the existing `classifyDeliveryFailure` string matching.**
  Mitigation: keep `classifyDeliveryFailure(message)` intact; the typed error's `message`
  still contains the human text, so classification is unchanged.

## Assumptions
- Prod runs a single pipeline container (one in-process pacer is authoritative).
- Resend remains the prod provider.
- Current/near-term list sizes are hundreds, not thousands (3/s is acceptable latency).

## External Dependencies & Fallback Chain

- **resend** (npm, already a dependency) — `client.emails.send`. Mature, actively
  maintained, already in production use. Auth: `RESEND_API_KEY` (env). Use cases to probe:
  (1) a successful single send returns `{ data: { id } }`; (2) a 429 returns
  `error.name === "rate_limit_exceeded"` and a `retry-after` header. **No new dependency
  is added** — this feature only reads fields already present on the Resend error response.
  Fallback chain: Resend → (already-present) SES provider → manual operator re-enqueue.
  Since no new library is introduced, the library-probe gate is expected to be
  NOT_APPLICABLE / lightweight (verify the error shape only).
