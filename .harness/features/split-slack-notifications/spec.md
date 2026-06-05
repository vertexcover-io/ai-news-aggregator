# SPEC: Split Slack Notifications

**Design:** `docs/spec/split-slack-notifications/design.md`
**Library probe:** `docs/spec/split-slack-notifications/library-probe.md` (PASS — no new deps)
**Date:** 2026-05-21

## Scope

Split the single combined `notifyNewsletterSent` Slack message into **four
independent messages**, each fired by the worker whose stage produces its
data:

1. `notifySourceDistribution` — from `run-process` after archive write.
2. `notifyEmailDelivery` — from `email-send` after subscriber delivery.
3. `notifyLinkedinPosted` — from `linkedin-post` after a successful post.
4. `notifyTwitterPosted` — from `twitter-post` after a successful post.

The legacy `notifyNewsletterSent` method and the dead
`packages/pipeline/src/workers/newsletter-send.ts` worker are **kept**
(marked `@deprecated`) — out-of-scope to delete.

## Requirements (EARS)

### REQ-001 — Source-distribution Slack message on rank complete

**When** the `run-process` worker writes a `run_archives` row on a
successful rank and `sourceTelemetry !== null` and `archive.isDryRun === false`,
**the system shall** post a Slack message titled `📊 Sources collected`
containing: digest headline (if any), per-source item-counts block, per-source
errors block (or "No collection errors"), and a context line with archive link
+ runId. **And** the system shall write
`run_archives.notification_state.sourceDistribution = <now>` upon HTTP 2xx.

### REQ-002 — Source-distribution skip on missing telemetry

**When** the rank completes but `sourceTelemetry === null` (legacy archive),
**the system shall not** post the source-distribution message and **shall**
log `slack.source_distribution.skipped reason=no_telemetry` at info level.

### REQ-003 — Source-distribution fires regardless of autoReview

**When** the source-distribution message is eligible per REQ-001,
**the system shall** post it whether `settings.autoReview === true` or
`settings.autoReview === false`. (Independent of `notifyReviewPending`,
which fires only on `!autoReview`.)

### REQ-004 — Email-delivery Slack message on email-send complete

**When** the `email-send` worker finishes its delivery loop (regardless of
how many subscribers were attempted) **and** `archive.isDryRun === false`,
**the system shall** post a Slack message titled `📬 Newsletter emailed`
containing: digest headline (if any), `Sent to X/Y subscribers (Z failed)`,
top-3 aggregated failure reasons (if any), and context line with archive
link + runId. **And** the system shall write
`run_archives.notification_state.emailDelivery = <now>` upon HTTP 2xx.

### REQ-005 — Email-delivery message dropped from email-send fan-out

**When** the `email-send` worker is on the active dispatch path
(`workers/processing.ts` case `"email-send"`), **the system shall not**
invoke `notifyNewsletterSent` from that worker. The legacy
`workers/newsletter-send.ts` is unchanged.

### REQ-006 — LinkedIn-posted Slack message

**When** the `linkedin-post` worker calls `linkedinNotifier.notifyArchiveReady`
and the result `status === "posted"` and `result.permalink !== null` and
`archive.isDryRun === false`, **the system shall** post a Slack message
titled `🟢 LinkedIn posted` containing: digest headline (if any), the
permalink rendered via the existing `renderPermalink` helper, and a context
line with archive link + runId. **And** the system shall write
`run_archives.notification_state.linkedinPosted = <now>` upon HTTP 2xx.

### REQ-007 — LinkedIn-posted skip on non-posted result

**When** the LinkedIn notifier returns `skipped`, `already_posted`, `failed`,
or `posted` with `permalink === null` (platform-reported duplicate),
**the system shall not** post the LinkedIn-posted Slack message. (The
existing `notifyPublishFailed` flow handles `failed`; the rest are silent.)

### REQ-008 — Twitter-posted Slack message

Symmetric to REQ-006 but for the `twitter-post` worker and `twitterPosted`
notification key.

### REQ-009 — Twitter-posted skip on non-posted result

Symmetric to REQ-007.

### REQ-010 — Idempotency across all four new keys

**When** any of the four new notifier methods is invoked and the
corresponding key in `run_archives.notification_state` is already set,
**the system shall not** re-post and **shall** log
`slack.<event>.skipped reason=already_notified` at info level.

### REQ-011 — Failure does not mark notified

**When** a Slack webhook POST returns non-2xx for any of the four new
methods, **the system shall not** write the corresponding
`notification_state` key, **shall** log `slack.<event>.failed` at warn
level with status + truncated response body, and **shall not** raise an
error to the surrounding worker.

### REQ-012 — Dry-run skip

**When** `archive.isDryRun === true` for any of the four new methods,
**the system shall** log `publish.skipped_dry_run` at info level and
return without posting and without writing the key.

### REQ-013 — Webhook unset skip

**When** `SLACK_WEBHOOK_URL` is unset or empty, **the system shall**
return a no-op `SlackNotifier` (existing behaviour in
`createSlackNotifier` early-return) — all four new methods resolve
to `Promise.resolve()` immediately.

### REQ-014 — NotificationKey union exhaustiveness

**The `NotificationKey` type** (in `packages/shared/src/types/notifications.ts`)
**shall** include the four new keys `sourceDistribution`, `emailDelivery`,
`linkedinPosted`, `twitterPosted` alongside the existing five. The
`markNotification` repo writer's parameter type **shall** be the union
itself (no `string`).

### REQ-015 — Legacy combined method preserved

**The `notifyNewsletterSent` method on `SlackNotifier`** **shall** remain
implemented and **shall** carry a `@deprecated` JSDoc annotation pointing
to the four replacement methods. The `slack_notified_at` column on
`run_archives` is unchanged.

### REQ-016 — Strict TypeScript

All new code **shall** pass `pnpm typecheck` with zero `any`, zero
`@ts-ignore`, zero `as unknown as X`. All new exported functions **shall**
have explicit return types.

### REQ-017 — Lint

All new code **shall** pass `pnpm lint` with zero warnings under the
project's eslint config including the local `@newsletter/eslint-plugin`
rules.

## Verification Scenarios

### VS-0 — Library probe re-verification

Folded in from `verification/verification-stubs.md`. No live external
re-verification needed; VS-1..VS-12 below cover the same surface via unit
tests against the stubbed `fetchFn`.

### VS-1 — REQ-001 happy path

**Setup:** Mock `archiveRepo.findById(runId)` returns archive with
`digestHeadline = "Foo"`, `sourceTelemetry` populated, `isDryRun=false`,
`notificationState = {}`. Stub `fetchFn` returns 200.
**Action:** Call `notifier.notifySourceDistribution({ runId })`.
**Assert:** `fetchFn` called once with `https://hooks.slack.com/...`; body
JSON has blocks with `📊 Sources collected` header, headline section, sources
block listing each source + total, errors block (empty case shows "No
collection errors"), context line with archive URL + runId.
`markNotification(runId, "sourceDistribution", <now>)` called once.

### VS-2 — REQ-002 missing telemetry

**Setup:** Archive has `sourceTelemetry: null`.
**Action:** Call `notifier.notifySourceDistribution({ runId })`.
**Assert:** `fetchFn` NOT called. `markNotification` NOT called. Log emitted
with `event: "slack.source_distribution.skipped"`, `reason: "no_telemetry"`.

### VS-3 — REQ-003 auto-review

**Setup:** Same as VS-1 but verifying call-site placement: `run-process.ts`
invokes `notifySourceDistribution` regardless of `settings.autoReview`
branch.
**Assert (integration test in `run-process.test.ts`):** Both autoReview=true
and autoReview=false paths reach the `notifySourceDistribution` call.

### VS-4 — REQ-004 happy path

**Setup:** `email-send` job with attempted=5, sent=4, failed=1, one failure
reason. Archive has headline.
**Action:** Run `handleEmailSendJob` end-to-end with a stub notifier.
**Assert:** `notifyEmailDelivery` called once with the correct
`{ runId, delivery: { attempted: 5, sent: 4, failed: 1, failureReasons: [...] } }`.
Builder renders header `📬 Newsletter emailed`, headline, line
`Sent to 4/5 subscribers (1 failed)`, top failure reason bullet, context.

### VS-5 — REQ-005 no combined notification

**Setup:** `email-send` worker invoked.
**Assert (negative):** Notifier spy verifies `notifyNewsletterSent` is
NOT called from the active `email-send.ts` path. Only
`notifyEmailDelivery` is called.

### VS-6 — REQ-006 LinkedIn happy path

**Setup:** `linkedin-post` worker; `linkedinNotifier.notifyArchiveReady`
stub returns `{ status: "posted", permalink: "urn:li:share:123" }`.
Archive has headline, isDryRun=false.
**Action:** Run `handleLinkedinPostJob`.
**Assert:** `notifyLinkedinPosted({ runId, permalink: "urn:li:share:123" })`
called. Builder renders header `🟢 LinkedIn posted`, headline,
`<https://www.linkedin.com/feed/update/urn:li:share:123|view>`, context.

### VS-7 — REQ-007 skip cases

**Cases:** linkedin notifier returns `{status:"skipped",...}`,
`{status:"already_posted",...}`, `{status:"failed",...}`,
`{status:"posted", permalink:null}`.
**Assert (negative for each):** `notifyLinkedinPosted` NOT called. Existing
behaviour for `failed` (the per-channel-failure notification) unchanged.

### VS-8 — REQ-008 Twitter happy path

Symmetric to VS-6. Permalink format `https://x.com/...`. Verifies
`notifyTwitterPosted` called and rendered correctly.

### VS-9 — REQ-009 Twitter skip cases

Symmetric to VS-7.

### VS-10 — REQ-010 idempotency

**Cases:** For each of the four new keys, set
`archive.notificationState[key]` to an existing timestamp.
**Assert:** Webhook POST NOT made. `markNotification` NOT called. Log
emitted at info level with `reason: "already_notified"`.

### VS-11 — REQ-011 failure does not mark

**Setup:** `fetchFn` returns 500.
**Action:** Call each of the four new notifier methods.
**Assert:** `markNotification` NOT called for that key. Warn log emitted
with `status: 500`. No exception escapes to the caller.

### VS-12 — REQ-012 dry-run skip

**Setup:** `archive.isDryRun = true`.
**Action:** Call each of the four new methods.
**Assert:** Webhook POST NOT made. `markNotification` NOT called. Info
log with `event: "publish.skipped_dry_run"`, `channel: "slack"`.

### VS-13 — REQ-013 webhook unset

**Setup:** `createSlackNotifier({ webhookUrl: undefined, ... })`.
**Assert:** Each of the four new methods is `() => Promise.resolve()` and
makes zero side effects.

### VS-14 — REQ-014 NotificationKey type

**Type-level test:** A `@ts-expect-error` test verifies that a typo
(`"sourceDistribuion"`) is rejected by the `markNotification` signature.

### VS-15 — REQ-015 legacy method preserved

**Assert:** `notifyNewsletterSent` is still on the `SlackNotifier`
interface and JSDoc has `@deprecated`. The legacy
`packages/pipeline/src/workers/newsletter-send.ts` still references it
without modification.

### VS-16 — REQ-016 + REQ-017 quality gates

`pnpm typecheck` exits 0. `pnpm lint` exits 0. `pnpm --filter @newsletter/shared test:unit`
exits 0 with the new builder + notifier tests included. `pnpm --filter @newsletter/pipeline test:unit`
exits 0 with the updated worker tests.

## Verification matrix

| REQ | Verified by |
|-----|-------------|
| REQ-001 | VS-1 |
| REQ-002 | VS-2 |
| REQ-003 | VS-3 |
| REQ-004 | VS-4 |
| REQ-005 | VS-5 |
| REQ-006 | VS-6 |
| REQ-007 | VS-7 |
| REQ-008 | VS-8 |
| REQ-009 | VS-9 |
| REQ-010 | VS-10 |
| REQ-011 | VS-11 |
| REQ-012 | VS-12 |
| REQ-013 | VS-13 |
| REQ-014 | VS-14 |
| REQ-015 | VS-15 |
| REQ-016+17 | VS-16 |

## Out of scope

- Removing the legacy `notifyNewsletterSent` method or
  `packages/pipeline/src/workers/newsletter-send.ts` worker.
- Removing or migrating the `run_archives.slack_notified_at` column.
- Slack threading (would require Slack Web API, not just webhook).
- Frontend / admin UI surfacing of notification state.
- Changes to `notifyReviewPending`, `notifyReviewWarning`,
  `notifyPublishFailed`, `notifyPublishUnavailable` behaviour.
- E2E tests against a real Slack workspace. (Unit tests with stubbed
  `fetchFn` exercise the same code path; this is consistent with the
  existing `notifier.test.ts` setup.)

## Files touched (from design §Wire-up)

- `packages/shared/src/types/notifications.ts` — extend `NotificationKey` union.
- `packages/shared/src/slack/types.ts` — add 4 input types + extend `SlackNotifier`.
- `packages/shared/src/slack/notifier.ts` — implement 4 new methods, `@deprecated` on the old.
- `packages/shared/src/slack/builders/source-distribution.ts` — new.
- `packages/shared/src/slack/builders/email-delivery.ts` — new.
- `packages/shared/src/slack/builders/linkedin-posted.ts` — new.
- `packages/shared/src/slack/builders/twitter-posted.ts` — new.
- `packages/shared/src/slack/builders/_helpers.ts` — shared formatters (headerBlock, sectionMarkdown, contextMarkdown, statusSuffix, truncate, renderPermalink) lifted from `message-builder.ts`.
- `packages/pipeline/src/workers/run-process.ts` — call `notifySourceDistribution` after archive upsert.
- `packages/pipeline/src/workers/email-send.ts` — swap `notifyNewsletterSent` → `notifyEmailDelivery`.
- `packages/pipeline/src/workers/linkedin-post.ts` — capture `SocialResult`, call `notifyLinkedinPosted` on posted+permalink.
- `packages/pipeline/src/workers/twitter-post.ts` — symmetric.
- Tests: new builder test files; updated worker tests (`run-process.test.ts`, `email-send.test.ts`, `linkedin-post.test.ts` if exists else publish-workers.test.ts, `twitter-post.test.ts` similarly).

## Manifest

- Spec name: `split-slack-notifications`
- Spec dir: `docs/spec/split-slack-notifications/`
- Worktree: `/Users/amankumar/Documents/newsletter/.worktrees/feature-split-slack-notifications`
- Branch: `feature/split-slack-notifications`
