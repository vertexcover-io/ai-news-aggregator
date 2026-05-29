# Design — Subscribe/Unsubscribe Audit + Slack Notifications

**Branch:** `fix/subscribe-trigger-and-notify`
**Base commit:** `60d748b` (already contains the targeted-vs-broadcast email fix)
**Scope:** Two parts — (1) audit + global protection against the trigger-collision class, (2) add Slack notifications on subscribe/unsubscribe.

---

## Part 1 — Trigger collision audit

### Original bug (already fixed)

Before `60d748b`, a new subscriber confirming between review and the 9 AM broadcast triggered a *targeted* welcome send (one subscriber) via the same `handleEmailSendJob` worker. The worker unconditionally:
1. checked `archive.emailSentAt !== null` → return (broadcast guard)
2. called `markEmailSent(runId)` after the loop (broadcast stamp)

Result: the targeted send stamped `email_sent_at`, and the next-morning broadcast saw it set and silently no-op'd. Whole subscriber list never got the digest.

### Current state of the fix (`packages/pipeline/src/workers/email-send.ts`)

- `const isBroadcast = subscriberIds === "all"` (line 241)
- Guard now gated: `if (isBroadcast && archive.emailSentAt !== null) return;` (line 260)
- Stamp now gated: early return before `markEmailSent` when `!isBroadcast` (line 397)
- Slack `notifyEmailDelivery` also gated to broadcast only (so a welcome send doesn't fire the "📬 Newsletter emailed" Slack summary)
- Per-subscriber dedup (`email_sends` table, line 279) still prevents duplicate delivery in both modes
- Unit tests covering both directions exist in `packages/pipeline/tests/unit/workers/email-send.test.ts`

### Audit of every other archive-level idempotency marker

I grepped every `mark*` writer and every `notification_state.*` key for the same anti-pattern. Results:

| Marker | Set by | Has a "targeted" sibling path? | Collision possible? |
|---|---|---|---|
| `run_archives.email_sent_at` | `email-send` worker | YES — welcome back-issue | ✅ Fixed by `60d748b` |
| `run_archives.linkedin_posted_at` | `linkedin-post` worker via `LinkedInNotifier.notifyArchiveReady` | NO — single channel, no targeted variant | None |
| `run_archives.twitter_posted_at` | `twitter-post` worker via `TwitterNotifier.notifyArchiveReady` | NO — symmetric to LinkedIn | None |
| `notification_state.sourceDistribution` | `run-process` worker after finalize | NO | None |
| `notification_state.emailDelivery` | `email-send` worker, **broadcast-only** branch | NO (now gated) | None |
| `notification_state.linkedinPosted` | `linkedin-post` worker on `posted` status | NO | None |
| `notification_state.twitterPosted` | `twitter-post` worker on `posted` | NO | None |
| `notification_state.linkedinFailure` / `twitterFailure` | respective workers on `failed` status | NO | None |
| `run_archives.reviewed` | `PATCH /api/admin/archives/:runId` only | NO | None |
| `run_archives.published_at` | `handleRunProcessJob` success finalize only | NO | None |

`packages/pipeline/src/workers/newsletter-send.ts` (legacy combined worker) is **not in the dispatch switch** in `processing.ts` — it's dead code kept for rollback. The deprecation comment in `CLAUDE.md` is accurate; it cannot be invoked by any current code path.

`packages/pipeline/src/social/test-post.ts` referenced in `CLAUDE.md` **does not exist** in the tree. CLAUDE.md is stale on this. No "send test post" route is mounted in `packages/api/src/routes/`. No live collision risk from that surface.

**Verdict for Part 1:** the original bug is fully addressed by `60d748b`. No other publish channel exhibits the same class of collision, because LinkedIn and Twitter have no "single-recipient" variant — they post once to the operator's own profile and the idempotency marker is the *desired* outcome of any path that calls them.

### Global protection (the "approach to prevent recurrence")

The bug class is: **"an archive-level idempotency marker is set by a worker that can be invoked in more than one mode, where the marker only makes sense for one of those modes."** Three lightweight invariants will keep this from recurring:

1. **Convention (doc):** in `packages/pipeline/CLAUDE.md`, add to the email-send section: *"Archive-level idempotency markers (`email_sent_at`, `linkedin_posted_at`, `twitter_posted_at`, `notification_state.*`) are written ONLY from the canonical scheduled/broadcast path. Any worker that supports a targeted/per-subscriber/manual variant MUST short-circuit before stamping the archive-level marker. Per-recipient dedup belongs on a per-recipient table (e.g. `email_sends`)."*
2. **Test pattern:** the existing test `email-send.test.ts` "targeted welcome send leaves broadcast guard untouched" is the template. We will add a sibling unit test asserting the targeted path also leaves `notification_state.emailDelivery` untouched. (Already implicitly verified by the Slack mock, but an explicit assertion turns it from "test happens to pass" to "test would fail if regressed".)
3. **No grep rule / ESLint rule needed** at this scale — the three marker writers are all in 5 lines of code each. Adding a custom lint rule for two-worker surface area would be overkill per `code-quality.md` ("no premature abstractions").

**No code change required for Part 1** beyond the doc paragraph + one extra test assertion. The structural fix is already in.

---

## Part 2 — Slack notification on subscribe / unsubscribe

### Goal

When the confirmed-subscribers list changes, send a Slack message including the affected email so the operator (Aman / Ritesh) knows immediately. Two events:

- **Subscribed** — fires at `POST /api/confirm` success transition (`pending → confirmed`). Not at `POST /api/subscribe` (that's just "email entered", may be a typo/bot/abandon).
- **Unsubscribed** — fires at `GET /api/unsubscribe` or one-click `POST /api/unsubscribe` success transition (`confirmed → unsubscribed`).

### Edge cases & mitigations (decided up front)

| # | Edge case | Mitigation |
|---|---|---|
| E1 | Slack webhook fails (non-2xx, timeout, DNS) | Catch + warn-log `slack.subscriber_changed.failed`. NEVER affect the HTTP response — the subscriber state is the source of truth. Same pattern as `notifyEmailDelivery` in `email-send.ts:414-423`. |
| E2 | `SLACK_WEBHOOK_URL` unset | The existing `createSlackNotifier` already returns a no-op stub (see `notifier.ts:42-47`). New methods follow the same pattern — zero-config disabled. |
| E3 | Confirm token replayed (already-confirmed subscriber) | Use repo-level "only update if status changed" returning a discriminated result `{changed: true, prev: SubscriberStatus, next: SubscriberStatus} \| {changed: false}`. Only fire Slack when `changed && next === "confirmed"`. Avoids spam from replays. |
| E4 | Unsubscribe of an already-unsubscribed user | Same repo-level `changed` check. Only fire when `changed && next === "unsubscribed"`. |
| E5 | Invalid/expired unsub token | Current code already returns success-with-no-DB-write to prevent enumeration. We branch on `result.valid` before firing Slack — already gated. |
| E6 | Race: two confirm tabs in parallel | DB UPDATE is atomic with `WHERE status <> 'confirmed'`. Only one wins → only one Slack fire. |
| E7 | PII (email in Slack) | The Slack channel is internal-only (operator team). User explicitly asked to include emails. We include the full address, masked only in *logs* (existing `maskEmail` in `subscribe.ts:19`). |
| E8 | Subscribe → unsubscribe → resubscribe loop (deliberate or accidental) | Each transition fires one message. If this becomes spammy, we'd add a per-subscriber dedup window — but per `code-quality.md` "no speculative features", we don't pre-build that. |
| E9 | High-rate signup burst (e.g. HN front-page) | Slack incoming webhooks rate-limit ~1/sec per webhook URL. We do not batch — if a burst exceeds the limit, individual sends will 429 and be logged but won't block confirm. Acceptable for a personal newsletter (<<1 confirm/sec). |
| E10 | Already-confirmed subscriber clicks unsubscribe link, then re-subscribes via POST /subscribe | Current `POST /subscribe` line 55-60 sees `existing` and returns idempotent OK without resetting status. So a re-activation path doesn't exist today. The fire-on-confirm rule still works correctly — only re-confirming via a *fresh* confirm token would fire. Out of scope to change `/subscribe` re-activation semantics. |
| E11 | Slack webhook is slow / hangs | Use the existing notifier (which already has a fetch with reasonable timeouts). Wrap the call in `void promise.catch(log)` so we don't block the HTTP response even if Slack is healthy. Actually — Slack notification can run after `c.redirect` returns by firing on `c.executionCtx.waitUntil()` if available, else just `void` the promise. Existing notifier patterns already use direct `await`; we'll match that since latency is small. |
| E12 | Welcome-back-issue enqueue (line 169) happens after confirm — Slack should fire *before* or independent of that? | Order: persist status → fire Slack → enqueue welcome → redirect. Slack fires regardless of whether welcome enqueue succeeds (welcome failure currently warn-logs and continues; same here). |
| E13 | Subscriber created in admin tool (out-of-band, no token) | Current code has no such admin route — not on the audit list. If/when added, the writer would need to call the same notifier. Out of scope. |
| E14 | `recordSesEvent` complaint/bounce → auto-unsubscribe via SES webhook | Need to check `webhooks/ses` handler. If it transitions confirmed → unsubscribed, it should also fire Slack with `via: "ses-bounce"` or `"ses-complaint"`. Will inspect during implementation phase. |
| E15 | Slack notifier method is called from API package, but `SlackNotifier` type lives in `@newsletter/shared` | Already imported in api via `@newsletter/shared`. No new wiring needed; just instantiate the same notifier from `SLACK_WEBHOOK_URL` env at API bootstrap (currently only pipeline instantiates it). Add `slackNotifier` to `SubscribeRouterDeps`. |

### Slack message shape

Match the existing terse one-line style of `notifyEmailDelivery`:

```
🟢 New subscriber: alice@example.com  (#42 total confirmed)
🔴 Unsubscribed: alice@example.com  (via one-click)  (#41 total confirmed)
```

Including the running total gives the operator immediate context. The total is a cheap `countConfirmed()` repo call we already have.

### Where things change

1. **`packages/shared/src/slack/types.ts`** — extend `SlackNotifier` interface:
   ```ts
   notifySubscriberConfirmed(input: { email: string; totalConfirmed: number }): Promise<void>;
   notifySubscriberUnsubscribed(input: { email: string; via: "GET" | "POST" | "ses-bounce" | "ses-complaint"; totalConfirmed: number }): Promise<void>;
   ```
2. **`packages/shared/src/slack/notifier.ts`** — implement the two methods (post a single `text:` block to the webhook); add no-op stubs to the disabled-mode object (line 42-47).
3. **`packages/api/src/repositories/subscribers.ts`** — change `updateStatus` to return a discriminated result indicating whether the status actually changed. Use `WHERE id = $1 AND status <> $2` and inspect `rowsAffected`. Existing call sites updated to consume new shape.
4. **`packages/api/src/routes/subscribe.ts`** — accept `slackNotifier` in `SubscribeRouterDeps`. In `/confirm`, after `updateStatus`, if `changed && next === "confirmed"`, call `notifier.notifySubscriberConfirmed(...)` inside try/catch. In `GET /unsubscribe` and `POST /unsubscribe`, do the same for `"unsubscribed"`.
5. **`packages/api/src/index.ts`** — instantiate Slack notifier from `SLACK_WEBHOOK_URL` env at bootstrap, pass into `createSubscribeRouter`.
6. **`packages/api/src/routes/webhooks.ts`** (SES) — if the bounce/complaint handler transitions confirmed → unsubscribed, fire Slack with `via: "ses-bounce"` / `"ses-complaint"`.
7. **`.env.example`** — `SLACK_WEBHOOK_URL` is already documented; no change.
8. **Tests** — unit tests in `packages/api/tests/unit/routes/subscribe.test.ts` (extend if exists, else create): assert that confirm-success fires `notifySubscriberConfirmed`, confirm-replay does NOT, unsubscribe-success fires `notifySubscriberUnsubscribed`, invalid-token does NOT, webhook failure does NOT bubble to HTTP response.

### Out of scope (not building, by design)

- Resubscribe flow (`POST /subscribe` for an existing `unsubscribed` row currently returns idempotent ok without re-activating — preserves existing behaviour).
- Per-subscriber dedup window for repeated sub/unsub flapping.
- Admin route to manually unsubscribe a subscriber.
- A new Slack channel separate from the existing `SLACK_WEBHOOK_URL`. We post to the same webhook the digest summaries go to.
- Backfill of past subscriber events.

---

## External Dependencies & Fallback Chain

No new external dependencies. We extend the existing `SlackNotifier` which already targets `SLACK_WEBHOOK_URL` via `fetch`. The library-probe stage is **NOT_APPLICABLE** (no new external API surface).

## Verification scenarios (lifted to spec)

VS-1. `POST /subscribe` followed by `GET /confirm?token=…` → assert one Slack call with `notifySubscriberConfirmed`, message contains email + total.
VS-2. `GET /confirm?token=…` replayed for an already-confirmed subscriber → assert ZERO new Slack calls (DB UPDATE no-ops because status already `confirmed`).
VS-3. `GET /unsubscribe?token=…` for a confirmed subscriber → assert one Slack call with `notifySubscriberUnsubscribed`, `via: "GET"`.
VS-4. `POST /unsubscribe` one-click (form-encoded) for confirmed subscriber → asserts one call, `via: "POST"`.
VS-5. `GET /unsubscribe?token=…` for an already-unsubscribed subscriber → ZERO Slack calls.
VS-6. Slack webhook returns 500 / network error → HTTP response is still 2xx/302; warn log emitted; no exception propagates.
VS-7. `SLACK_WEBHOOK_URL` unset → both notifier methods are no-ops; no fetch attempted; tests pass.
VS-8. SES bounce webhook flips confirmed → unsubscribed → Slack fires with `via: "ses-bounce"`.
VS-9. Targeted welcome email send (`subscriberIds: ["new-uuid"]`) for an archive whose `email_sent_at IS NULL` → after the send, assert `email_sent_at` is STILL NULL, `notification_state.emailDelivery` is STILL absent, and the next broadcast still delivers. (This re-verifies the Part-1 fix as a regression guard.)
