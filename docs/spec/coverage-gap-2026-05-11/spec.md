# Coverage Gap Spec — 2026-05-11

## Coverage Summary

| Package | Current Coverage | Threshold | Gap |
|---------|-----------------|-----------|-----|
| `@newsletter/pipeline` | 84.31% | 90% | 5.69 pp |
| `@newsletter/api` | 71.32% | 90% | 18.68 pp |
| `@newsletter/shared` | 80.39% | 90% | 9.61 pp |
| `@newsletter/web` | ~72% | 90% | ~18 pp |

## Scope

This spec targets **unit-testable gaps only** — functions that can be tested without a live database or Redis connection. Repository classes (which require live DB) and full page components (which require routing context) are out of scope for this pass.

## Per-File Analysis

### 1. `packages/pipeline/src/lib/delay.ts` (50% — lines 3-6, 13-19 uncovered)

**What it does:** Wraps `setTimeout` in a Promise with optional `AbortSignal` support. Two paths are uncovered: (a) early-reject when signal is already aborted before the timer starts, and (b) reject via the `abort` event listener while the timer is running.

**Tests to write:** (`packages/pipeline/tests/unit/lib/delay.test.ts`)
- Resolves after the specified duration with no signal
- Rejects immediately when signal is already aborted before calling `delay`
- Rejects when signal is aborted while the timer is still running
- Uses the signal's `reason` as the rejection error when it is an `Error` instance
- Falls back to a generic "aborted" error when `signal.reason` is not an `Error`

**Fixtures needed:** `AbortController` (built-in Node.js global)

---

### 2. `packages/api/src/lib/sns-verifier.ts` (23.91% — lines 17-51, 97-122 uncovered)

**What it does:** Verifies AWS SNS webhook messages. Uncovered code includes `assertAmazonsCertUrl` (URL validation), `buildSigningString` (constructs the string SNS signs — different format for Notification vs SubscriptionConfirmation types), and `verifySnsMessage` (the full verification pipeline including crypto verify).

**Tests to write:** (`packages/api/tests/unit/lib/sns-verifier.test.ts` — extend existing file)
- `assertAmazonsCertUrl` (tested indirectly via `verifySnsMessage`):
  - `verifySnsMessage` rejects when `SigningCertURL` is not a valid URL
  - `verifySnsMessage` rejects when `SigningCertURL` hostname is not `*.amazonaws.com`
- `buildSigningString`:
  - Notification type includes Message, MessageId, Timestamp, TopicArn, Type keys
  - SubscriptionConfirmation type includes SubscribeURL and Token keys in addition
- `verifySnsMessage` with injectable `certFetcher`:
  - Returns parsed message when signature is valid (use real `crypto` to generate a test key pair and sign)
  - Throws "SNS message signature verification failed" when signature is wrong
  - Calls the injected `certFetcher` with the `SigningCertURL`

**Fixtures needed:** Generate a test RSA key pair with `node:crypto` `generateKeyPairSync` to produce valid signatures in tests. The `certFetcher` is injectable — pass a stub that returns the public key PEM.

---

### 3. `packages/pipeline/src/workers/processing.ts` (45.56% — send-newsletter case uncovered)

**What it does:** Single BullMQ dispatcher that routes jobs by `job.name`. The `send-newsletter` case is not yet covered.

**Tests to write:** (extend `packages/pipeline/tests/unit/workers/processing.test.ts`)
- Routes `job.name === 'send-newsletter'` to `handleNewsletterSendJob`
- Lazily builds `newsletterSendDeps` on first `send-newsletter` job (the `resolvedNewsletterSendDeps ??=` branch)
- Reuses the already-resolved deps on the second `send-newsletter` job (the lazy-build branch is NOT re-entered)

**Mocks needed:**
- `@pipeline/workers/newsletter-send.js` → mock `handleNewsletterSendJob`
- `newsletterSendDeps` option injected as `{ fake: "ns-deps" }`

---

### 4. `packages/api/src/lib/email/resend-provider.ts` (0%) and `packages/api/src/lib/email/ses-provider.ts` (0%)

**What they do:** Thin adapters over Resend SDK and AWS SESv2 SDK respectively. The core behavior is the `send()` method.

**Tests to write:** (`packages/api/tests/unit/lib/email/resend-provider.test.ts` and `ses-provider.test.ts`)

**`resend-provider.ts`:**
- `send()` maps params to Resend SDK call and returns `{ messageId }` on success
- `send()` throws with message `"Resend error: <message>"` when `result.error` is non-null
- All params (from, to, subject, html, text, replyTo, headers) are forwarded to the SDK

**`ses-provider.ts`:**
- `send()` maps params to `SendEmailCommand` and returns `{ messageId }` on success
- `send()` maps custom `headers` object to `{ Name, Value }[]` format for SES
- `send()` omits `Headers` from SES command when no `headers` param provided
- `send()` omits `ReplyToAddresses` from SES command when no `replyTo` param provided
- `send()` returns `{ messageId: "" }` when `result.MessageId` is undefined (edge case)

**Mocks needed:**
- For Resend: `vi.mock("resend", ...)` returning a controllable `emails.send` stub
- For SES: `vi.mock("@aws-sdk/client-sesv2", ...)` returning a controllable `send` stub

---

### 5. `packages/pipeline/src/processors/recap.ts` (55% branches — lines 44, 55, 76-81)

**What it does:** Generates structured recap for a news item using Claude via `generateObject`. Uncovered branches: using a custom `generateObject` function (line 44), using `process.env.RANKING_MODEL` override (line 45/55), and the error-logging + re-throw path (lines 76-81).

**Tests to write:** (extend `packages/pipeline/tests/unit/processors/` — new file `recap.test.ts`)
- Uses injected `generateObject` when provided in options (not the default import)
- Uses `process.env.RANKING_MODEL` as model ID when set
- Falls back to `DEFAULT_MODEL` when `RANKING_MODEL` env var is not set
- Returns `result.object` on success
- Logs the error and re-throws when `generateObject` throws an `Error`
- Wraps non-Error throws in a new `Error` and re-throws

---

### 6. `packages/pipeline/src/workers/daily-run.ts` (73.33% branches — lines 77-82)

**What it does:** `createDailyRunWorker` factory with fallback logic: `connection ?? options.redis ?? createRedisConnection()`. Lines 77-82 are the factory's default-building branches when `connection`, `redis`, or `queue` options are absent.

**Tests to write:** (extend `packages/pipeline/tests/unit/workers/daily-run.test.ts`)
- `createDailyRunWorker` uses `options.connection` when provided
- `createDailyRunWorker` falls back to `options.redis` when `connection` is absent
- `createDailyRunWorker` calls `createRedisConnection()` when neither is provided

---

### 7. `packages/pipeline/src/workers/run-process.ts` (86.66% branches — lines 550-558, 593-601)

**What it does:** Two error-handling branches: (a) error when enqueueing the send-newsletter job after auto-review (lines 550-558), and (b) error when writing the cancelled archive (lines 593-601). Both log the error but do not re-throw.

**Tests to write:** (extend `packages/pipeline/tests/unit/workers/run-process.test.ts`)
- Logs an error but does not throw when `sendQueue.add()` fails during auto-review enqueue
- Logs an error but does not throw when `archiveRepo.upsert()` fails during cancellation handling

---

## Testing Conventions

- Named imports only — no default imports from test helpers
- `vi.mock()` calls hoisted at top of file, before imports
- `vi.fn()` for all external dependencies (SDK clients, DB repos)
- Behavior-driven test names: `test_<behavior_description>` or `it("does X when Y")`
- `describe` blocks group related behaviors for a single exported function
- No shared mutable state between tests — reset mocks in `beforeEach`
- Use `vi.hoisted()` for spy setup when needed before module resolution
- Tests import from `@pipeline/...` / `@api/...` aliases (not relative paths)
- Use `it()` not `test()` (project convention)

## Acceptance Criteria

- [ ] All new tests pass (`pnpm --filter <pkg> test:unit`)
- [ ] No existing tests broken
- [ ] `delay.ts` reaches ≥ 90% branch coverage
- [ ] `sns-verifier.ts` reaches ≥ 80% statement coverage (verifySnsMessage fully covered)
- [ ] `processing.ts` worker reaches ≥ 70% statement coverage (send-newsletter case covered)
- [ ] `resend-provider.ts` and `ses-provider.ts` reach ≥ 85% statement coverage
- [ ] `recap.ts` reaches ≥ 85% branch coverage
- [ ] Tests follow project conventions (behavior-driven, no mock-internals assertions)
