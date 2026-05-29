# Adversarial Findings — email-rate-limit-retry

**Date:** 2026-05-29
**Result: No exploitable gaps found. All scenarios held.**

---

## Scenario (a): Rate ceiling could still be exceeded

### Attack: Fresh pacer created per job, bypassing the shared singleton

**Attempt:** Look for any code path in `handleEmailSendJob` that constructs a new `SendPacer`
without going through `getSharedPacer()`.

**Code path inspected:**
```ts
const pacer = deps.sendPacer ?? getSharedPacer();
```

`deps.sendPacer` is only non-null in unit tests (injected fake). In production, `deps.sendPacer` is
never set (not in `EmailSendDeps` construction in `processing.ts`), so `getSharedPacer()` is always
called. `getSharedPacer()` lazily initializes a module-scoped singleton:
```ts
let sharedPacer: SendPacer | null = null;
export function getSharedPacer(): SendPacer {
  sharedPacer ??= createSendPacer(resolveSendRate(process.env));
  return sharedPacer;
}
```
The `??=` assignment is synchronous and atomic in single-threaded Node.js. No race condition.

**Result: HELD** — no path creates a fresh pacer in production; the singleton is always used.

### Attack: Retries bypass pacer (retry does not re-acquire)

**Attempt:** Check if the retry loop re-acquires the pacer before the second send attempt.

**Code path inspected:**
```ts
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  await pacer.acquire();  // <-- top of loop, runs on EVERY iteration including retry
  try {
    ...send...
  } catch (sendErr) {
    if (retryable && attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs);
      continue;  // re-enters loop → pacer.acquire() is called again
    }
    throw sendErr;
  }
}
```

`pacer.acquire()` is at the top of the `for` loop body, so it runs on every iteration including
retries. `continue` after `sleep` goes back to `await pacer.acquire()`.

**Result: HELD** — retries are pacer-gated (REQ-010 verified by test).

### Attack: Two concurrent email-send jobs run simultaneously, each with the shared pacer

**Attempt:** `Promise.allSettled` over multiple subscribers means recipients within a job run
concurrently. Could two jobs running at the same time (BullMQ default concurrency > 1) each
acquire the pacer independently and still burst?

**Finding:** The `createSendPacer` implementation serializes all `acquire()` calls via a promise
chain:
```ts
return {
  acquire(): Promise<void> {
    const run = chain.then(next);
    chain = run.catch(() => undefined);
    return run;
  },
};
```
All concurrent `acquire()` calls — regardless of which job or recipient they originate from —
queue on the same `chain`. So even if two jobs ran in the same process concurrently, their
recipients would serialize through the same token bucket. The shared singleton amplifies this
guarantee across jobs.

**Result: HELD** — concurrent recipients serialize through the chain; the shared pacer ensures
cross-job ordering.

---

## Scenario (b): A failed send is NOT retried when it should be, or retried when it shouldn't

### Attack: Retryable error on attempt 2 triggers a third attempt (unbounded retry)

**Attempt:** With `MAX_ATTEMPTS = 2` and loop `attempt = 1..2`: on attempt=2 failure, check:
```ts
if (retryable && attempt < MAX_ATTEMPTS) { ... continue; }
throw sendErr;
```
`attempt < MAX_ATTEMPTS` = `2 < 2` = `false`. So the `continue` is never taken on attempt=2.
The error is rethrown immediately — no third attempt.

**Result: HELD** — max 2 attempts enforced.

### Attack: Non-retryable error triggers a retry via the network/timeout heuristic

**Attempt:** `isRetryable(err)` function:
```ts
function isRetryable(err: unknown): boolean {
  if (err instanceof EmailSendError) return err.retryable;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset");
}
```

For `EmailSendError` instances (Resend path): `err.retryable` is determined by
`RETRYABLE_RESEND_CODES.has(code)` at throw time. `validation_error` has `retryable: false` → not
retried. The network heuristic only applies to non-`EmailSendError` throws (e.g., a raw `fetch`
timeout from the SES path). This is correct.

**Result: HELD** — non-retryable codes fail fast; heuristic only applies to untyped errors.

### Attack: `retryAfterMs = 0` causes the retry to sleep 0ms and skip re-acquiring

**Attempt:** When `retryAfterMs` is 0 (EDGE-003 — `retry-after: '0'` or `'-5'` → clamped to 0):
```ts
const backoffMs =
  sendErr instanceof EmailSendError && sendErr.retryAfterMs !== null
    ? sendErr.retryAfterMs  // = 0
    : attempt * 1000;
await sleep(backoffMs);  // sleep(0) — resolves immediately
continue;  // re-enters loop → pacer.acquire() called again
```
`0 !== null` is `true`, so `sleep(0)` is called (immediate resolve). The `continue` then loops
back to `await pacer.acquire()` before re-sending. The pacer still gates the retry even though
the sleep was instantaneous.

**Result: HELD** — retryAfterMs=0 causes sleep(0) then pacer.acquire() on retry.

---

## Scenario (c): Recipient double-counted or double-sent (email_sends row dup)

### Attack: Attempt 1 throws after `emailSendsRepo.create` is called

**Attempt:** Look at the send loop:
```ts
const result = await deps.emailProvider.send({...});
await deps.emailSendsRepo.create({...});  // only runs on success
okCount += 1;
return; // exits attempt loop
```
`emailSendsRepo.create` is only called after `emailProvider.send` resolves successfully. On throw
from `send`, the catch block fires before `create` is ever called. So there is no scenario where
`create` is called for a failed attempt.

**Result: HELD** — `email_sends` row is written only on successful send (EDGE-007 verified by test).

### Attack: Two successful recipients both match `alreadySent` filtering incorrectly

**Attempt:** The `alreadySent` set is loaded once per job before the send loop. Within a job run,
no recipient can double-send because the batch loops and each recipient is in `toSend` exactly once
(filtered via `Set.has`). Across job runs, the DB dedup (`findSentSubscriberIds`) prevents re-send.

**Result: HELD** — per-recipient dedup is correct.

---

## Scenario (d): Broadcast-vs-targeted 60d748b semantics regressed

### Attack: Targeted send stamps `emailSentAt` (poisons broadcast guard)

**Attempt:** The broadcast gate:
```ts
if (isBroadcast && archive.emailSentAt !== null) return;
```
Only blocks when `isBroadcast` is true. For targeted sends, `isBroadcast = false`, so this never
blocks them. After the send loop, `markEmailSent` is only called for broadcasts:
```ts
if (!isBroadcast) return;
await deps.archiveRepo.markEmailSent(runId, new Date());
```

**Result: HELD** — targeted sends do not stamp `emailSentAt`; `notifyEmailDelivery` is not called
for targeted sends (correct, unchanged from pre-feature behavior; test REQ-015 regresses green).

---

## Summary

| Scenario | Result |
|----------|--------|
| (a) Fresh pacer created per job | HELD — singleton always used in production |
| (a) Retries bypass pacer | HELD — pacer.acquire() at top of for-loop |
| (a) Two concurrent jobs burst | HELD — chain serializes all acquires across the process |
| (b) Third attempt triggered | HELD — `attempt < MAX_ATTEMPTS` hard-stops at 2 |
| (b) Non-retryable gets retried | HELD — `err.retryable` respected; heuristic isolated to untyped errors |
| (b) retryAfterMs=0 skips pacer | HELD — sleep(0) then pacer.acquire() on continue |
| (c) email_sends double-written | HELD — create() only on provider success |
| (c) Per-recipient double-send | HELD — alreadySent dedup + single iteration |
| (d) Targeted stamps emailSentAt | HELD — isBroadcast guard unchanged |

**No exploitable gap was found. Feature is functionally correct per spec.**
