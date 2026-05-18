# Coverage Gap Spec

Generated: 2026-05-18

## Coverage Summary

| Package | Current Coverage | Threshold | Gap |
|---------|-----------------|-----------|-----|
| `@newsletter/api` | 74.49% | 90% | 15.51 pp |
| `@newsletter/pipeline` | 76.15% | 90% | 13.85 pp |
| `@newsletter/shared` | 64.83% | 90% | 25.17 pp |
| `@newsletter/web` | 73.75% | 90% | 16.25 pp |

All four packages are below the 90% threshold. This spec focuses on files with the greatest
coverage impact that can be tested with pure unit tests — no real DB or network required.

## Uncovered Files (Selected for This Spec)

| Package | File | Coverage | Missing Lines |
|---------|------|----------|---------------|
| shared | `src/slack/builders/review-pending.ts` | ~3% | All behavior |
| shared | `src/slack/builders/review-warning.ts` | ~15% | All behavior |
| shared | `src/slack/builders/publish-failed.ts` | ~15% | All behavior |
| shared | `src/utils/index.ts` | 0% | All (detectAddPostSourceType) |
| api | `src/lib/sns-verifier.ts` | 22% | assertAmazonsCertUrl, buildSigningString, verifySnsMessage |
| api | `src/routes/subscribe.ts` | 75% | GET /confirm, GET /unsubscribe, POST /unsubscribe |
| pipeline | `src/workers/linkedin-post.ts` | 0% | handleLinkedInPostJob |
| pipeline | `src/workers/twitter-post.ts` | 0% | handleTwitterPostJob |
| pipeline | `src/workers/review-warning.ts` | ~2% | handleReviewWarningJob |

---

## Per-File Analysis

### `packages/shared/src/slack/builders/review-pending.ts` (~3% covered)

**Uncovered behaviors:**
- `buildReviewPendingMessage` with `publicArchiveBaseUrl` set → review URL is embedded in context block
- `buildReviewPendingMessage` without `publicArchiveBaseUrl` → fallback to `runId: <id>` text
- `buildReviewPendingMessage` with empty string `publicArchiveBaseUrl` → same fallback
- `buildReviewPendingMessage` with a trailing slash in `publicArchiveBaseUrl` → URL is trimmed
- `buildReviewPendingMessage` with null `digestHeadline` → default section text used
- `buildReviewPendingMessage` with a non-null `digestHeadline` → bold headline in section

**Test file:** `packages/shared/tests/unit/slack/builders/review-pending.test.ts`

**Conventions:** `describe`/`it`, `import { describe, it, expect } from "vitest"`, no mocks needed (pure).

---

### `packages/shared/src/slack/builders/review-warning.ts` (~15% covered)

**Uncovered behaviors:**
- `buildReviewWarningMessage` with `publicArchiveBaseUrl` → URL in context block
- `buildReviewWarningMessage` without `publicArchiveBaseUrl` → fallback context text
- Channel label mapping: `email-send` → "Email", `linkedin-post` → "LinkedIn", `twitter-post` → "Twitter"
- `minutesUntil` value is interpolated correctly in section text
- `earliestTime` value is interpolated correctly in section text

**Test file:** `packages/shared/tests/unit/slack/builders/review-warning.test.ts`

---

### `packages/shared/src/slack/builders/publish-failed.ts` (~15% covered)

**Uncovered behaviors:**
- `buildPublishFailedMessage` for each channel (`email-send`, `linkedin-post`, `twitter-post`)
- With `publicArchiveBaseUrl` → link in context
- Without `publicArchiveBaseUrl` → fallback context text

**Test file:** `packages/shared/tests/unit/slack/builders/publish-failed.test.ts`

---

### `packages/shared/src/utils/index.ts` (0% covered)

**Uncovered behaviors:**
- `detectAddPostSourceType` with `news.ycombinator.com/item?id=<digits>` → returns `"hn"`
- `detectAddPostSourceType` with `hn.algolia.com` and hash matching story pattern → returns `"hn"`
- `detectAddPostSourceType` with `www.reddit.com/r/<sub>/comments/<id>/<slug>` → returns `"reddit"`
- `detectAddPostSourceType` with `old.reddit.com/r/<sub>/comments/<id>/<slug>` → returns `"reddit"`
- `detectAddPostSourceType` with a generic URL → returns `"web"`
- `detectAddPostSourceType` with an invalid URL string → returns `"web"` (catch fallback)
- `detectAddPostSourceType` with `news.ycombinator.com/item` (no id param) → returns `"web"`
- `detectAddPostSourceType` with HN item URL where id is non-numeric → returns `"web"`

**Test file:** `packages/shared/tests/unit/utils.test.ts`

---

### `packages/api/src/lib/sns-verifier.ts` (22% covered)

Currently only `parseSnsMessageUnchecked` is tested. The following are uncovered:

**Uncovered behaviors:**
- `assertAmazonsCertUrl`: invalid URL string → throws "Invalid SigningCertURL"
- `assertAmazonsCertUrl`: non-amazonaws.com hostname → throws with hostname in message
- `assertAmazonsCertUrl`: valid `*.amazonaws.com` URL → does not throw
- `buildSigningString` for `Notification` type → includes Message, MessageId, Timestamp, TopicArn, Type (no SubscribeURL/Token)
- `buildSigningString` for `SubscriptionConfirmation` type → includes SubscribeURL and Token
- `verifySnsMessage`: valid signature with mocked `certFetcher` → resolves with parsed message
- `verifySnsMessage`: non-amazonaws cert URL → rejects before fetching cert
- `verifySnsMessage`: invalid signature → throws "SNS message signature verification failed"

Note: `assertAmazonsCertUrl` and `buildSigningString` are not exported but are exercised through
`verifySnsMessage`. Use the exported `verifySnsMessage` (with a mock `certFetcher`) plus the
exported `parseSnsMessageUnchecked` to test internal behavior indirectly. For direct tests of
internal helpers, use dynamic imports or expose the helpers if necessary — prefer testing via
`verifySnsMessage` to avoid coupling tests to internal structure.

**Test file:** `packages/api/tests/unit/lib/sns-verifier.test.ts` (extend existing file)

**Fixtures needed:** A real self-signed PEM cert + corresponding signed string to test the
happy path of `verifySnsMessage`. Generate one with Node's `crypto` in a test helper.

---

### `packages/api/src/routes/subscribe.ts` (75% covered)

Currently covered: `POST /subscribe` happy path and duplicate subscriber. Uncovered:

**Uncovered behaviors for `GET /confirm`:**
- Valid token → subscriber moved to confirmed, redirects to `/confirm?status=success`
- Valid token + recent reviewed archive → `sendNewsletterToSubscriber` called with correct args
- Valid token + welcome send fails → still redirects success (error swallowed)
- Expired token → redirects to `/confirm?status=expired`
- Wrong-type token (e.g. unsub token used on confirm endpoint) → redirects to `/confirm?status=invalid`
- Token missing/malformed → redirects to `/confirm?status=invalid`

**Uncovered behaviors for `GET /unsubscribe`:**
- Valid unsub token → subscriber marked unsubscribed, redirects `/unsubscribe?status=success`
- Invalid/expired token → still redirects `/unsubscribe?status=success` (anti-enumeration)

**Uncovered behaviors for `POST /unsubscribe`:**
- JSON body with valid token → subscriber marked unsubscribed, returns `{ ok: true }`
- Form-encoded body with valid token → subscriber marked unsubscribed
- JSON body with invalid token → logs warning, returns `{ ok: true }`
- Request with no token → logs warning, returns `{ ok: true }`

**Test file:** `packages/api/tests/unit/routes/subscribe.test.ts` (new file)

**Fixtures needed:**
- `makeDeps()` factory returning all mocked deps (subscribersRepo, sendConfirmationEmail, etc.)
- Use `issueSubscriberToken` from `@api/lib/subscriber-token.js` to mint valid tokens in tests

---

### `packages/pipeline/src/workers/linkedin-post.ts` (0% covered)

The function `handleLinkedInPostJob` takes injected deps with no side effects beyond calling deps.

**Uncovered behaviors:**
- Job name is not `"linkedin-post"` → returns immediately without touching deps
- Archive not found (`archiveRepo.findById` returns null) → returns immediately
- Archive found but not reviewed → calls `slackNotifier.notifyPublishFailed` with `{ runId, channel: "linkedin-post" }`
- Archive found, reviewed, already posted (`linkedinPostedAt` not null) → returns without calling notifier
- Archive found, reviewed, not posted → calls `linkedinNotifier.notifyArchiveReady({ runId })`
- `linkedinNotifier` is null → no error thrown even when archive is reviewed and not posted

**Test file:** `packages/pipeline/tests/unit/workers/linkedin-post.test.ts`

**Conventions:** Use `vi.fn()` for all deps; match style of `newsletter-send.test.ts`.

---

### `packages/pipeline/src/workers/twitter-post.ts` (0% covered)

Mirror of `linkedin-post.ts`. Same shapes, different job name and fields.

**Uncovered behaviors:**
- Job name is not `"twitter-post"` → returns immediately
- Archive not found → returns immediately
- Archive not reviewed → calls `slackNotifier.notifyPublishFailed` with `{ runId, channel: "twitter-post" }`
- Archive reviewed, already posted (`twitterPostedAt` not null) → returns without calling notifier
- Archive reviewed, not posted → calls `twitterNotifier.notifyArchiveReady({ runId })`
- `twitterNotifier` is null → no error thrown

**Test file:** `packages/pipeline/tests/unit/workers/twitter-post.test.ts`

---

### `packages/pipeline/src/workers/review-warning.ts` (~2% covered)

**Uncovered behaviors:**
- Job name is not `"review-warning"` → returns immediately
- Archive not found → returns immediately
- Archive already reviewed → returns immediately
- `userSettingsRepo.get()` returns null → returns immediately
- Settings has `autoReview: true` → returns immediately (no warning needed)
- All publish channels disabled or already sent → no slack notification sent
- One enabled channel exists → `slackNotifier.notifyReviewWarning` called with correct args
- `slackNotifier` is undefined → no error thrown

**Internal helpers to cover via integration:**
- `enabledTargets`: filters channels by `enabled` flag and whether already posted
- `earliestEnabledPublish`: returns the channel with the earliest scheduled time

**Test file:** `packages/pipeline/tests/unit/workers/review-warning.test.ts`

**Fixtures needed:** `makeSettings()` factory; `makeArchive()` factory. Import `dateAtTzTime` from
`@newsletter/shared` only for constructing expected values, not for assertions on internals.

---

## Testing Conventions

All tests in this project follow these conventions:

- **Framework:** `vitest` with `describe`/`it`/`expect` (no globals — explicit imports only)
- **Naming:** Behavior-driven: `it("returns ok when subscriber already exists")`
- **Factory functions:** `function makeX(overrides: Partial<X> = {}): X { ... }` — one per complex type
- **Mocking:** `vi.fn()` for repo/service deps; no test doubles for pure functions
- **No class-based tests** — function-based test suites only
- **Async:** Use `async/await` in `it` callbacks; no `.then()` chains
- **No shared mutable state** between tests — each test arranges its own state
- **Import paths:** Use package aliases (`@api/...`, `@pipeline/...`, `@shared/...`)

---

## Acceptance Criteria

- [ ] `packages/shared/tests/unit/slack/builders/review-pending.test.ts` — all 6 behaviors pass
- [ ] `packages/shared/tests/unit/slack/builders/review-warning.test.ts` — all 5 behaviors pass
- [ ] `packages/shared/tests/unit/slack/builders/publish-failed.test.ts` — all 3 behaviors pass
- [ ] `packages/shared/tests/unit/utils.test.ts` — all 8 behaviors for `detectAddPostSourceType` pass
- [ ] `packages/api/tests/unit/lib/sns-verifier.test.ts` — extended with 8 new behaviors, all pass
- [ ] `packages/api/tests/unit/routes/subscribe.test.ts` — all 13 behaviors for confirm/unsubscribe pass
- [ ] `packages/pipeline/tests/unit/workers/linkedin-post.test.ts` — all 6 behaviors pass
- [ ] `packages/pipeline/tests/unit/workers/twitter-post.test.ts` — all 6 behaviors pass
- [ ] `packages/pipeline/tests/unit/workers/review-warning.test.ts` — all 8 behaviors pass
- [ ] `pnpm typecheck` passes with zero errors across all packages
- [ ] `pnpm test:unit` passes across all packages
- [ ] No existing tests are broken by the new additions
