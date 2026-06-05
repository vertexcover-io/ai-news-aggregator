# Design: Split Slack Notifications

**Spec name:** `split-slack-notifications`
**Status:** Draft
**Author:** orchestrate pipeline
**Date:** 2026-05-21

## Problem Statement

Today the pipeline emits a single combined Slack message — `🟢 Newsletter Sent` —
that bundles four logically independent pieces of information:

1. 📊 Per-source item counts (collection telemetry)
2. ⚠️ Per-source collection errors
3. 📬 Email delivery counts (sent / failed / failure reasons)
4. 🔗 LinkedIn + X (Twitter) post results (status + permalinks)

These four pieces are produced at **different points in time**: source telemetry
is finalised when ranking completes, email delivery completes when the
`email-send` worker finishes, and LinkedIn / Twitter posts complete when each
of their own per-channel workers finishes — and those channels can be scheduled
**independently of each other** (`linkedin-post`, `twitter-post`, `email-send`
are already three separate BullMQ jobs).

Bundling them forces the message to wait for the slowest channel, hides early
signals (the operator can't see source/error telemetry until email + social
have all completed), and conflates failures in one channel with success in
another.

## Context

### Current code (verified)

- **Combined message builder:** `packages/shared/src/slack/message-builder.ts`
  → `buildReviewedMessage()` returns a single multi-block message.
- **Combined sender:** `packages/shared/src/slack/notifier.ts` →
  `notifyNewsletterSent()`, gated on `archive.slackNotifiedAt`.
- **Active call site:** `packages/pipeline/src/workers/email-send.ts:363` — the
  email-send worker fires it after delivery and after fan-out to LinkedIn +
  Twitter notifiers.
- **Legacy / dead call site:** `packages/pipeline/src/workers/newsletter-send.ts:399` —
  the older `send-newsletter` job is no longer dispatched by
  `packages/pipeline/src/workers/processing.ts` (no `case "send-newsletter"`),
  but the file still exists.
- **Existing per-channel architecture:** `processing.ts` already dispatches
  `email-send`, `linkedin-post`, and `twitter-post` as **three independent jobs**.
  Each has a `slackNotifier?: SlackNotifier` dep; only `email-send` currently
  invokes it.
- **Existing review-pending ping:** `notifyReviewPending` already fires from
  `run-process.ts:779` after archive write, carrying headline + archive link only.
- **Existing notification idempotency:** `run_archives.notification_state` JSONB
  with keys defined in `packages/shared/src/types/notifications.ts`: today
  `reviewPending | reviewWarning | emailFailure | linkedinFailure | twitterFailure`.
  Idempotency is enforced inside the `notifyWithMarker` helper in `notifier.ts`.
- **Legacy success column:** `run_archives.slack_notified_at` (timestamp, set by
  the combined `notifyNewsletterSent`). Will be **kept** on the row for
  backwards-compat with the dead `newsletter-send.ts` path, but no longer
  consulted by the new notifiers.

### Existing message data shape

`buildReviewedMessage` (in `message-builder.ts`) consumes:

- `archive.digestHeadline` (or fallback `topRankedTitle`)
- `sourceTelemetry: RunSourceTelemetry | null` — per-source `displayName`,
  `itemsFetched`, `status`, `retries`, `errors[]`, plus a totals line.
- `delivery: DeliveryCounts` — `attempted`, `sent`, `failed`, `failureReasons[]`.
- `socialResults?: SocialResultsForSlack` — `linkedin?: SocialPostReport`,
  `twitter?: SocialPostReport`.
- `publicArchiveBaseUrl` for the archive link.

Everything we need to split the message is already plumbed; the changes are
restructural, not data-shape.

## Requirements

### Functional

- **FR-1** — A new Slack message **"📊 Sources collected"** fires immediately
  after the rank stage completes (after `run_archives.upsert` writes the new
  archive row in `run-process.ts`), carrying headline + per-source item
  counts + per-source errors block. Fires for **both** manual-review and
  auto-review runs (independent of `settings.autoReview`).
- **FR-2** — A new Slack message **"📬 Newsletter emailed"** fires from
  `email-send.ts` after subscriber delivery completes, carrying headline +
  delivery counts + (if any) top-3 aggregated failure reasons. Replaces the
  current combined message at line 363 of `email-send.ts`.
- **FR-3** — A new Slack message **"🟢 LinkedIn posted"** fires from
  `linkedin-post.ts` after `notifyArchiveReady` returns `posted`, carrying
  headline + LinkedIn permalink. Suppressed when the notifier returns
  `skipped` (no creds) or `already_posted`. On `failed`, the existing
  `notifyPublishFailed` path fires (unchanged).
- **FR-4** — A new Slack message **"🟢 X (Twitter) posted"** fires from
  `twitter-post.ts` symmetric to FR-3.
- **FR-5** — Each of the four new messages is idempotent: each tracks a
  dedicated key in `run_archives.notification_state` JSONB
  (`sourceDistribution`, `emailDelivery`, `linkedinPosted`, `twitterPosted`).
  Re-runs of the same job do not re-notify.
- **FR-6** — `notifyReviewPending` (existing, minimal "ready for review"
  ping) remains unchanged. It fires from `run-process.ts:779` only when
  `!settings.autoReview`. Operators may receive two messages in quick
  succession (source-distribution then review-pending) when manual review
  is required.
- **FR-7** — All four messages skip-with-info-log when `SLACK_WEBHOOK_URL`
  is unset (existing `createSlackNotifier` early-return path covers this).
- **FR-8** — All four messages skip-with-info-log when `archive.isDryRun`
  is true (existing `notifyWithMarker` path covers this).

### Non-functional

- **NFR-1** — No new external dependencies. Slack incoming webhook only.
- **NFR-2** — No new DB columns. Reuse `notification_state` JSONB.
- **NFR-3** — Each Slack POST has a 1× attempt only (matches today). A
  network/HTTP failure is logged as `slack.*.failed` and never blocks the
  surrounding worker.
- **NFR-4** — Strict TypeScript, no `any`, exhaustive `NotificationKey`
  union.
- **NFR-5** — Existing combined `buildReviewedMessage` and
  `notifyNewsletterSent` are **not deleted** — marked `@deprecated` and
  kept so the legacy `newsletter-send.ts` worker compiles.

### Edge cases

- **EC-1** — `sourceTelemetry === null` (legacy archive without telemetry):
  the source-distribution message is **skipped** (debug-logged); no point
  posting a "Telemetry unavailable" message. The legacy combined message
  did render "Telemetry unavailable (legacy run)"; we drop that because
  with the new split the message would be empty of useful content.
- **EC-2** — Headline absent (`digestHeadline === null`): include only the
  data block; omit the headline section.
- **EC-3** — `delivery.attempted === 0` (no subscribers): the
  `notifyEmailDelivery` message still fires with `0/0` so the operator
  knows the send job ran but found no recipients. Suppression would hide
  a real ops signal (e.g. subscriber list is empty in prod).
- **EC-4** — LinkedIn / Twitter notifier returns `skipped` (no creds) or
  `already_posted` (duplicate detected by the platform): the new
  `notifyLinkedinPosted` / `notifyTwitterPosted` is **not** invoked.
  These outcomes are operationally uninteresting and already logged.
- **EC-5** — Retry of an `email-send` job (BullMQ) after a partial failure:
  the second attempt sees `notification_state.emailDelivery` already
  populated and skips the Slack post (existing `notifyWithMarker` skip
  path).
- **EC-6** — A `run-process` job re-runs (manual /run page) on the same
  archive id: source-distribution sees `notification_state.sourceDistribution`
  populated and skips. (Per FR-5 idempotency.)
- **EC-7** — Slack rate-limiting: Slack webhooks tolerate ~1 msg/sec
  with bursts. The four messages fire from four **separate BullMQ jobs**
  (run-process → email-send → linkedin-post → twitter-post), each typically
  seconds-to-minutes apart per the user's send schedule, so bursting is
  not a realistic risk.

## Key Insights

1. **The four-channel architecture already exists.** `email-send`,
   `linkedin-post`, `twitter-post` are already three independent BullMQ
   workers with separate schedules and separate retry/failure behaviour.
   Today they share a Slack message; making them not share is mostly a
   restructuring of where each `slackNotifier.notify*` call lives.

2. **The existing `notifyWithMarker` helper does the heavy lifting.**
   The idempotency, dry-run skip, and archive-missing-warn logic in
   `packages/shared/src/slack/notifier.ts` is a generic pattern keyed by
   `NotificationKey`. We only need to add four new keys + four new
   builder/notifier method pairs that reuse it.

3. **Source-distribution belongs to the rank stage, not the send stage.**
   The user's stated intent — "as soon as the pipeline is done ranking
   the items we must receive a Slack message about the source distribution
   and errors" — places this message in `run-process.ts`, not in the send
   workers. This frees us from waiting for send-time and surfaces
   collection problems while the operator could still act on them.

4. **`SocialResult` is already returned but discarded.** In
   `linkedin-post.ts:29` and `twitter-post.ts:29`, the per-channel workers
   `await deps.linkedinNotifier?.notifyArchiveReady(...)` and throw away
   the `posted | skipped | already_posted | failed` result. Capturing this
   is required to drive the new per-channel success message with the right
   permalink.

## Architectural Challenges

### C1 — Notification-key sprawl

The `NotificationKey` union now has 5 entries (3 failure, 2 progress) and
will grow to 9 (3 failure, 2 progress, 4 success). All keys go through
the same `notifyWithMarker` helper. Risk: a typo in a key string at a call
site would silently broaden idempotency to "anything". Mitigation: define
the four new keys in the existing `NotificationKey` union (compile-time
exhaustive); `markNotification` repo writer accepts only `NotificationKey`.

### C2 — Backwards-compat with legacy `slack_notified_at`

The `notifyNewsletterSent` call site in the dead `newsletter-send.ts`
worker writes `archive.slackNotifiedAt`. The active `email-send.ts`
also currently uses it. After the split, the new `notifyEmailDelivery`
will write `notification_state.emailDelivery` instead. The legacy
column stays in the schema (no DB migration) and remains the gate for
the legacy `notifyNewsletterSent` path. New code does **not** read or
write it. This keeps the PR scope-tight.

### C3 — Co-existence of new and legacy combined message

Until the dead `newsletter-send.ts` worker is removed (out of scope for
this PR per "no scope creep"), both `notifyNewsletterSent` and the four
new methods exist on the `SlackNotifier` interface. The interface grows
by four methods. The legacy one is marked `@deprecated` in JSDoc but not
removed.

### C4 — `SocialResult` flow change in two workers

`linkedin-post.ts` and `twitter-post.ts` need to:

1. Capture the `SocialResult` return value.
2. On `status === "posted"`, fetch the archive headline (via the existing
   `archiveRepo.findById`) and fire `notifySlackXPosted(...)`.

This adds one DB read per channel per send. Acceptable — already done
once in `notifyWithMarker` via `deps.archives.findById(input.runId)`,
which we can let do the work without re-loading in the worker.

## Approaches Considered

### Approach A — Add four new methods, deprecate the combined one (chosen)

Four new methods on `SlackNotifier`: `notifySourceDistribution`,
`notifyEmailDelivery`, `notifyLinkedinPosted`, `notifyTwitterPosted`. Four
new builders in `packages/shared/src/slack/builders/`. Existing combined
method kept for the dead legacy worker.

**Pros:** Minimal disruption. Each method is independently testable.
Symmetric with the existing per-channel-failure pattern
(`notifyPublishFailed`). Easy to revert if needed.

**Cons:** Interface grows. Some duplication between the new
`notifyEmailDelivery` builder and the existing `📬 Distribution` block
inside `buildReviewedMessage`.

### Approach B — Generic `notifyChannel(channel, status, payload)`

A single dispatch method that takes a channel + status union. Internally
routes to the right builder.

**Pros:** Slimmer interface.

**Cons:** Discriminated-union payloads grow gnarly fast (delivery counts
vs. permalink vs. source telemetry have nothing in common). Loses
compile-time clarity at call sites. More indirection for what is
fundamentally four distinct messages.

### Approach C — Move the combined message into a "review-pending+1" model

Pile the source telemetry onto `notifyReviewPending`, and split only
the send-time messages.

**Pros:** Reduces total message count.

**Cons:** User explicitly rejected this in clarification — they want
source telemetry to fire **regardless of whether manual review is
required** (auto-review runs should still get the source breakdown).
Also conflates "operator must act" with "data telemetry."

### Approach D — Use Slack threading (post follow-ups as replies to the rank message)

Post source-distribution as the head, then thread email / linkedin /
twitter messages under it.

**Pros:** Cleaner Slack UI; all activity on one run lives in one thread.

**Cons:** Requires Slack Web API (channel + thread_ts), not just the
incoming webhook. That's a meaningful auth + scope change. Out of scope
for the user's stated ask. Could be a follow-up.

## Chosen Approach: A

Add four new methods + four new builders; deprecate the combined method;
keep the legacy column.

## High-Level Design

### New types (in `packages/shared/src/slack/types.ts`)

```
SourceDistributionInput      { runId: string }
EmailDeliveryInput           { runId: string; delivery: DeliveryCounts }
LinkedinPostedInput          { runId: string; permalink: string }
TwitterPostedInput           { runId: string; permalink: string }
```

(All four read `headline` + `sourceTelemetry` from the archive via the
existing `archives.findById` path inside `notifyWithMarker`.)

### Notification keys (in `packages/shared/src/types/notifications.ts`)

```
type NotificationKey =
  | "reviewPending"
  | "reviewWarning"
  | "emailFailure"
  | "linkedinFailure"
  | "twitterFailure"
  // new:
  | "sourceDistribution"
  | "emailDelivery"
  | "linkedinPosted"
  | "twitterPosted";
```

### New builders (in `packages/shared/src/slack/builders/`)

- `source-distribution.ts` → builds: header `📊 Sources collected`, headline
  section, sources block, errors block, context line with archive link +
  runId. (Source + errors logic lifted from `message-builder.ts` lines
  73-103; shared helpers — `statusSuffix`, `truncate`, etc. — moved to
  a new internal `_shared.ts` to avoid duplication.)
- `email-delivery.ts` → builds: header `📬 Newsletter emailed`, headline
  section, delivery line (`Sent to X/Y subscribers (Z failed)`), top-3
  failure reasons if any, context line. (Distribution logic lifted from
  `message-builder.ts` lines 105-129.)
- `linkedin-posted.ts` → builds: header `🟢 LinkedIn posted`, headline
  section, single section with `<permalink|View on LinkedIn>`, context
  line with archive link + runId.
- `twitter-posted.ts` → symmetric.

### Notifier additions (in `packages/shared/src/slack/notifier.ts`)

Four new methods, each implemented with the existing `notifyWithMarker`
helper, passing the appropriate `key` and `event` strings and a `blocks`
factory that calls the matching builder.

### Wire-up

| File | Change |
|------|--------|
| `packages/pipeline/src/workers/run-process.ts` (line ~778) | After archive write, before `notifyReviewPending`, call `slackNotifier.notifySourceDistribution({ runId })` if `sourceTelemetry !== null`. |
| `packages/pipeline/src/workers/email-send.ts` (line ~363) | Replace `notifyNewsletterSent(...)` with `notifyEmailDelivery({ runId, delivery })`. Drop the `socialResults` argument plumbing from email-send (LinkedIn/Twitter no longer flow through email-send's Slack call). |
| `packages/pipeline/src/workers/linkedin-post.ts` (line ~29) | Capture the `SocialResult` from `notifyArchiveReady`. If `status === "posted"`, call `slackNotifier?.notifyLinkedinPosted({ runId, permalink })`. |
| `packages/pipeline/src/workers/twitter-post.ts` (line ~29) | Symmetric to linkedin-post. |
| `packages/pipeline/src/workers/newsletter-send.ts` (legacy) | No code change. Continues to call the deprecated `notifyNewsletterSent`. |
| `packages/shared/src/slack/notifier.ts` | Four new methods + JSDoc `@deprecated` on `notifyNewsletterSent`. |
| `packages/shared/src/slack/types.ts` | Four new input types; four new method signatures on `SlackNotifier`. |
| `packages/shared/src/slack/builders/` | Four new builder files + a small shared `_helpers.ts`. |
| `packages/shared/src/types/notifications.ts` | Extend the `NotificationKey` union with the four new keys. |

### Idempotency flow (per message)

```
notifyXxx(runId, payload)
  └─ notifyWithMarker
        ├─ archives.findById(runId)
        │     └─ null  → log "archive_missing", return
        ├─ archive.isDryRun  → log "skipped_dry_run", return
        ├─ archive.notificationState[key] !== undefined
        │     → log "skipped already_notified", return
        ├─ postToWebhook(url, blocks)
        │     └─ !ok  → log "failed", return (NO marker write)
        └─ archives.markNotification(runId, key, now)  → log "sent"
```

This flow already exists; the four new methods plug in via the `blocks`
factory.

## Open Questions

None — clarified by the user up front.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Notification-state JSONB collisions during concurrent writes (e.g. email-send and linkedin-post running at the same instant) | Low | Low | `markNotification` already uses a JSONB merge / partial UPDATE pattern in the repo (verified in `packages/api/src/repositories/run-archives.ts`). PostgreSQL `jsonb_set` is atomic per row; concurrent keys won't clobber. |
| Operator drowned by 4 messages per send | Low | Low | Each message is concise and channel-specific. They arrive minutes apart (per schedule), not bunched. Slack threading is a future-PR follow-up. |
| `notifyEmailDelivery` fires with attempted=0 every day if no subscribers | Low | Medium | Per EC-3, this is intentional — suppresses would hide an ops signal. Operator can ignore zero-count messages. |
| Tests for the existing combined message reference data shape we're not changing — false sense of coverage | Medium | Medium | New builder tests are required and called out explicitly in spec REQ matrix. Existing `message-builder.test.ts` and `notifier.test.ts` stay green (combined path still exists). |
| Partial-update writer (`markNotification`) hitting a missing archive row — per learning `partial-update-db-writers-precondition.md` | Low | Medium | All four new call sites fire **after** the archive row is guaranteed to exist (run-process: just upserted at line 745; email-send/linkedin-post/twitter-post: archive is found at the top of the worker, otherwise the worker no-ops). Explicit assertion in tests. |
| `linkedin-post.ts` calls `notifyArchiveReady` but the `SocialResult` shape doesn't actually expose a `permalink` on `posted` | Medium (need to verify) | High (would block the feature) | Verified in code review: `SocialResult` with `status: "posted"` carries `permalink: string \| null`. If `null` (duplicate detected by platform), we treat it like `already_posted` and skip the success message. |

## Assumptions

- Slack webhook posting library/path stays as today (`webhook-client.ts` →
  `postToWebhook`); no auth/scope changes.
- `run_archives.notification_state` already exists as `jsonb` and the
  `markNotification` repo writer is in place (verified via grep on
  `run-archives.ts`).
- `SocialResult.permalink` on `posted` status carries the platform URL or
  URN (LinkedIn URN gets rendered via the existing `renderPermalink`
  helper).
- Tests use vitest + msw or stub fetch (consistent with the existing
  `notifier.test.ts`).
- Slack rate limiting is not a concern at the four-messages-per-run rate
  spread across separate jobs.

## External Dependencies & Fallback Chain

**Slack Incoming Webhooks API** — already in use throughout the
project, no new integration.

- **Maturity signals:** Stable, used in production today. Last
  meaningful API change: 2021 (Block Kit v2). Slack's incoming webhooks
  are a long-term stable surface; no deprecation signals.
- **Distinct use cases to probe:**
  1. POST a Block Kit message with header + section + context blocks
     (same shape we already use for the combined message).
  2. Verify the response shape on non-2xx (rate limit, invalid payload).
- **Auth surface:** Webhook URL only (no token). Env var:
  `SLACK_WEBHOOK_URL` (already in `.env.harness` per existing usage).
- **Fallback chain:**
  1. **Slack Incoming Webhook** (chosen — already in use).
  2. **Slack Web API** with `chat.postMessage` (would unlock threading —
     future-PR option).
  3. **Skip Slack notifications entirely** (graceful degradation — the
     existing `createSlackNotifier` already returns no-op methods when
     `SLACK_WEBHOOK_URL` is unset, so this is the natural fallback if
     credentials disappear or webhooks are revoked in prod).
  4. **Pivot to a different transport** (email summary, Discord webhook,
     custom HTTP callback) — only if Slack itself becomes unreliable.

Since this PR uses **only the surface we already exercise daily**, the
library-probe stage may declare it `VERIFIED_BY_EXISTING_USAGE` rather
than running a fresh credential probe — the existing
`notifier.test.ts` + `webhook-client.ts` round-trip is the same code
path the new builders will hit.
