# Adversarial Findings — Subscribe Trigger + Slack Notify

**Date:** 2026-05-29  
**Approach:** Role-swap attacker mindset. Scenarios tested mentally against the actual implementation.

---

## Scenario 1 — What if the email field on a confirmed subscriber is `null`?

**Prediction:** The notifier would receive `null` and emit `null` in the Slack message.

**Code inspection result:** `packages/shared/src/db/schema.ts` line 218: `email: text("email").notNull()`. The `subscribers.email` column has `.notNull()`. Drizzle enforces this at the TypeScript type level — `SubscriberSelect.email` is `string`, not `string | null`. Additionally the DB schema has a NOT NULL constraint, so a null email cannot exist in a row returned by `findById`/`findByEmail`/`updateStatus`.

**Verdict:** Verified non-issue. The schema prevents null emails at the DB and type-system level.

---

## Scenario 2 — What if `countConfirmed()` itself throws?

**Prediction:** The exception would propagate out of the `if (changed && ...)` block, bubbling to the route handler, which would return a 500 instead of the expected redirect.

**Code inspection result:** In `packages/api/src/routes/subscribe.ts`, the pattern at the confirm and unsubscribe routes is:

```ts
const totalConfirmed = await deps.subscribersRepo.countConfirmed(); // <-- not inside try/catch
void deps.slackNotifier.notifySubscriberConfirmed({ email, totalConfirmed }).catch(log);
```

The `countConfirmed()` call is awaited directly before the `void notifier...` call. It is NOT wrapped in a try/catch. If `countConfirmed` throws (e.g. DB connection drop), the exception propagates to the Hono route handler and the subscriber sees a 500 instead of a 302.

**Finding severity:** LOW — This is a DB-down scenario. The subscriber state was already committed (`updateStatus` succeeded before this point), so the subscription is real — only the Slack notification and redirect are affected. The subscriber would see an error page on a DB outage. A truly bulletproof implementation would wrap `countConfirmed` + `notifySubscriberConfirmed` inside a single try/catch that falls back to a redirect without counting. However, this matches the existing error handling pattern in the codebase (e.g. `sendNewsletterToSubscriber` is separately try/caught but individual awaits between status mutations and their follow-ups are not individually hardened). Acceptable for a personal newsletter with reliable DB infra.

**Recommendation:** Low-priority improvement — wrap the full `if (changed) { countConfirmed + notify }` block in a try/catch that logs and continues to the redirect. Not a blocking defect.

---

## Scenario 3 — What if someone submits a confirm token for a subscriber whose row has been deleted?

**Prediction:** `updateStatus` would find no row, throw `Error('subscriber <id> not found')`, and the route handler would return 500.

**Code inspection result:** In `packages/api/src/routes/subscribe.ts`, the confirm flow calls `deps.subscribersRepo.findByConfirmToken(token)` first. If no row matches the token, the route returns early with a 400/404 before ever reaching `updateStatus`. If the row exists at token-lookup time but is deleted between lookup and `updateStatus` (TOCTOU race), `updateStatus` would throw `Error('subscriber ${id} not found')` because the conditional UPDATE would return 0 rows and the follow-up SELECT would also return 0 rows, hitting the `throw` at line 106 of `subscribers.ts`.

**Verdict:** Verified non-issue for the normal case (no row for token = early return). The TOCTOU race window is microseconds and extremely unlikely in practice. The resulting 500 would be a one-off with no data corruption risk (no state was mutated).

---

## Scenario 4 — What if the Slack webhook URL points at a non-Slack host (per the existing `parseHost` warn)?

**Prediction:** The notifier warns but still POSTs to the non-Slack URL.

**Code inspection result:** In `packages/shared/src/slack/notifier.ts` lines 57-65:

```ts
if (!webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
  logger.warn({ event: "slack.notify.suspicious_url", host: parseHost(webhookUrl) }, "...");
}
```

After the warning, execution continues normally. The POST is attempted to whatever URL is configured. This is by design — the check is advisory, not a blocker. The operator might legitimately use a non-Slack webhook aggregator (e.g. Opsgenie, PagerDuty, custom ingestor).

**Verdict:** Verified non-issue. Warning-only guard is intentional. The `SLACK_WEBHOOK_URL` is operator-controlled.

---

## Scenario 5 — Confirmed subscriber re-confirms (resubscribe-after-unsub attempt via fresh token)

**Design doc question:** Would `subscribedAt` from the `extra` param be written on the no-op branch?

**Code inspection result:** `updateStatus` at line 90-106 of `subscribers.ts`:

```ts
const updatedRows = await db.update(subscribers)
  .set({ status, updatedAt: new Date(), ...(extra ?? {}) })
  .where(and(eq(subscribers.id, id), ne(subscribers.status, status)))
  .returning();
for (const updated of updatedRows) {
  return { changed: true, next: status, row: updated };
}
// no rows updated — fall through to SELECT
const currentRows = await db.select()...
for (const current of currentRows) {
  return { changed: false, next: current.status, row: current };
}
throw new Error(`subscriber ${id} not found`);
```

The `extra` fields (including `subscribedAt`) are passed in the `SET` clause. The `WHERE` guard is `status <> $newStatus`. If a subscriber is already `confirmed` and `/confirm` is hit again, the WHERE guard blocks the UPDATE — 0 rows are returned, `extra.subscribedAt` is NOT written to the DB, `changed: false` is returned, and Slack does NOT fire.

**Verdict:** Verified intentional behaviour. The design doc (design.md E3) documents this: "DB UPDATE is atomic with WHERE status <> 'confirmed'. Only one wins." The `subscribedAt` field is silently dropped on no-op. This is correct: we don't want to reset `subscribedAt` on a replay. Documented as acceptable.

---

## Scenario 6 — SES sends a Permanent bounce for a subscriber that's already unsubscribed

**Prediction:** `updateStatus(id, "bounced")` would check `WHERE status <> 'bounced'`. If the subscriber is `unsubscribed`, status IS different from `bounced`, so the UPDATE would succeed, `changed: true` is returned, and Slack would fire.

**Code inspection result:** Confirmed. The `WHERE status <> $newStatus` guard only protects against re-applying the *same* status. It does NOT protect against transitioning from `unsubscribed → bounced`. A previously-unsubscribed subscriber receiving an SES Permanent bounce would:
1. Have their DB status changed from `unsubscribed` to `bounced`
2. Trigger `notifySubscriberRemoved({ via: "bounce", ... })`

The Slack notification fires correctly — the operator should know the address is hard-bouncing. The status transition `unsubscribed → bounced` is arguably wrong at the DB level (why bounce an already-inactive subscriber?), but it is a pre-existing behaviour of the SES webhook handler (not introduced by this PR). The Slack notification correctly surfaces this edge case to the operator.

**Verdict:** Verified non-issue for Slack notification purposes. The notification is accurate (a hard bounce happened). The `unsubscribed → bounced` DB transition is a pre-existing edge case outside this PR's scope.

---

## Summary

| Scenario | Verdict | Notes |
|---|---|---|
| 1 — null email | Verified non-issue | Schema enforces NOT NULL; TypeScript type is `string` |
| 2 — `countConfirmed` throws | Low-priority finding | Unguarded await could 500 on DB outage; state already committed; acceptable for this project's infra |
| 3 — deleted subscriber token replay | Verified non-issue for normal case | TOCTOU race is microsecond window; no data corruption |
| 4 — non-Slack webhook URL | Verified non-issue | Warning-only guard is intentional; POST still attempted |
| 5 — resubscribe-after-unsub via replay | Verified intentional | `subscribedAt` not written on no-op; Slack not fired; correct |
| 6 — bounce for already-unsubscribed | Finding (pre-existing) | `unsubscribed → bounced` transition fires Slack correctly; DB transition is pre-existing behaviour outside PR scope |

No blocking defects found. Finding in Scenario 2 is a hardening suggestion for a future PR.
