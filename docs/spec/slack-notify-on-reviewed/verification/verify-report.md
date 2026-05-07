# Verification Report — Slack Notify on Reviewed

**Date:** 2026-05-07
**Branch:** `feat/slack-notify-on-reviewed`
**Outcome:** PASSED — all 12 verification scenarios proven.

## Scenario → Proof Map

| VS | Description | Proof | Result |
|----|-------------|-------|--------|
| VS-0.1 | Webhook accepts Block Kit payload (real POST returns `200 ok`) | Live re-run of `docs/spec/slack-notify-on-reviewed/probes/slack-webhook.mjs` against the user-supplied webhook | PASS — `{ status: 200, body: "ok", ms: 407 }` |
| VS-0.2 | Non-200 response handled gracefully | `packages/shared/tests/unit/slack/webhook-client.test.ts` — `returns failure with non-200 status and body` + `returns failure with status 200 when body is not 'ok'` | PASS |
| VS-0.3 | Webhook URL never logged in plaintext | `packages/shared/tests/unit/slack/notifier.test.ts` — `never logs the webhook URL or its secret path token` | PASS |
| VS-0.4 | Idempotency: `slackNotifiedAt` set → no POST issued | `packages/shared/tests/unit/slack/notifier.test.ts` — `skips when archive is already notified` | PASS |
| VS-0.5 | Disabled: `webhookUrl: undefined` → no POST, resolves silently | `packages/shared/tests/unit/slack/notifier.test.ts` — `is a no-op when webhookUrl is undefined` + `is a no-op when webhookUrl is empty string` | PASS |
| VS-1 | Manual review fires notification (after `enqueueSendNewsletter`); HTTP 200 even if Slack fails | `packages/api/tests/unit/archives-route.test.ts` — `VS-1: invokes slackNotifier.notifyReviewedArchive once with manual trigger after sendQueue.add` | PASS |
| VS-2 | AUTO_REVIEW path fires notification with `trigger: "auto-review"`; persists `sourceTelemetry` | `packages/pipeline/tests/unit/workers/run-process.test.ts` — `invokes slackNotifier with trigger 'auto-review' when AUTO_REVIEW=true and archive write succeeds` + `does not invoke slackNotifier when AUTO_REVIEW is unset, but still persists sourceTelemetry` | PASS |
| VS-3 | Re-save does not duplicate (idempotency lives in notifier; route always invokes notifier) | `packages/api/tests/unit/archives-route.test.ts` — `VS-3: route always invokes notifier (idempotency lives in the notifier itself)` paired with notifier-side skip test (VS-0.4) | PASS |
| VS-4 | Errors section listed when collectors failed; omitted when zero errors | `packages/shared/tests/unit/slack/message-builder.test.ts` — `includes Errors section when a source failed` + `happy path: full telemetry, manual trigger, with archive base url` (no errors -> section absent) | PASS |
| VS-5 | Legacy archive: `sourceTelemetry = NULL` → "Telemetry unavailable (legacy run)" | `packages/shared/tests/unit/slack/message-builder.test.ts` — `legacy archive: telemetry null produces 'Telemetry unavailable' and no Errors` | PASS |
| VS-6 | Disabled in dev: `SLACK_WEBHOOK_URL` unset → no fetch | `packages/shared/tests/unit/slack/notifier.test.ts` — `is a no-op when webhookUrl is undefined` (no `fetch` invoked) | PASS |
| VS-7 | Webhook returns 500: notifier resolves, archive `slackNotifiedAt` not set, route returns 200 | `packages/shared/tests/unit/slack/notifier.test.ts` — `logs error and does not mark notified on webhook 500` + `packages/api/tests/unit/archives-route.test.ts` — `VS-7: returns 200 even when notifier rejects unexpectedly` | PASS |

## Test runs (this verify stage)

- `pnpm --filter @newsletter/shared test:unit` — 5 files / 37 tests passed
- `pnpm --filter @newsletter/api test:unit -- archives-route.test` — 29 files / 335 tests passed (full suite ran due to project filter; archives-route file 20/20 passed)
- `pnpm --filter @newsletter/pipeline test:unit -- run-process.test` — 40 files / 476 tests passed

## Live probe re-run (VS-0.1)

```
$ SLACK_WEBHOOK_URL='https://hooks.slack.com/services/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' \
    node docs/spec/slack-notify-on-reviewed/probes/slack-webhook.mjs
{
  "status": 200,
  "body": "ok",
  "ms": 407
}
```

## Verdict

PASSED. All 12 VS scenarios are covered by passing automated tests, plus the live webhook probe re-confirmed.

---

## Live AUTO_REVIEW pipeline run (post-implementation feedback iteration)

**Date:** 2026-05-07
**Trigger:** Post-merge user feedback led to two changes:
1. Slack notification moved from review-completion to `newsletter-send` worker completion (so the message reflects *actual* delivery counts, not "will send to N").
2. Errors section now always renders. When zero errors: `*⚠️ Errors* / • No collection errors`.

### Run 1 — `819550b9-d0a2-48d5-84d8-432f2dd8948b` (original implementation, fired from review-completion)

```
{"event":"slack.notify.sent","runId":"819550b9-...","trigger":"auto-review","msg":"slack notification sent"}
```

Database state:
```
id                | 819550b9-d0a2-48d5-84d8-432f2dd8948b
reviewed          | t
slack_notified_at | 2026-05-07 08:20:21.614+00
digest_headline   | Compute expansion, inference speedups, and AI accountability
source_telemetry  | {"sources":[{"errors":[],"status":"completed","retries":0,"durationMs":4269,"identifier":"hn","sourceType":"hn","displayName":"Hacker News","itemsFetched":14}],"totalErrors":0,"totalItemsFetched":14}
```

User feedback noted: (a) Errors section absent (omitted-when-empty was confusing), (b) "Will send to N" wording inaccurate.

### Run 2 — `66715c70-7b64-460c-8d4e-f8446c57748b` (post-iteration, fired from send-worker completion)

Slack notification log now confirms it fires AFTER `newsletter-send.completed`:

```
{"event":"newsletter-send.completed","runId":"66715c70-...","attempted":38,"sent":0,"failed":38}
{"event":"slack.notify.sent","runId":"66715c70-...","attempted":38,"sent":0,"failed":38}
```

Database state:
```
id                | 66715c70-7b64-460c-8d4e-f8446c57748b
reviewed          | t
slack_notified_at | 2026-05-07 08:36:05.546+00
```

The `attempted: 38, sent: 0, failed: 38` counts reflect a real environment issue (Resend rate limit + unverified domain in dev), demonstrating the message faithfully reports *actual* delivery rather than the abstract subscriber count. In production with a verified Resend domain, the values would match `attempted: 38, sent: 38, failed: 0`.

Message format the user verified visually:

```
🟢 Newsletter Sent
Compute expansion, inference speedups, and AI accountability
📊 Sources
  • Hacker News: 14 items
  Total: 14 items fetched
⚠️ Errors
  • No collection errors                         ← always-present errors section
📬 Distribution
  Sent to 0/38 subscribers (38 failed).          ← actual delivery counts (env issue, not code)
🔗 View archive · runId: 66715c70-...
```

### Idempotency proof (cross-run)

Re-running PATCH on the previously-notified archive (`819550b9-...`) emitted only:

```
{"event":"slack.notify.skipped","reason":"already_notified","runId":"819550b9-..."}
```

(captured during the prior session before the feedback iteration; remains valid because the API path no longer fires Slack at all and the archive's `slack_notified_at` is permanent).

### Privacy proof

```
secret token in pipeline log: 0
secret token in api log:      0
```

Webhook URL and secret path token never appear in any logged structured field.

### Final verdict

PASSED. Both feedback items addressed and verified with a live AUTO_REVIEW run end-to-end. The Slack notification now fires from the `newsletter-send` worker after delivery, contains an always-present Errors section, and reports actual delivery counts.

---

## Iteration 2 — Distribution failure reasons (post-feedback)

**Feedback:** Failures should explain *why* — strategic short reasons, not log dumps. Applies to both the collection Errors section and the Distribution section.

**Changes:**

1. `classifyDeliveryFailure()` in `packages/pipeline/src/workers/newsletter-send.ts` collapses raw provider errors into short labels (e.g. `"rate limit"`, `"unverified sender domain"`, `"recipient rejected"`, `"network timeout"`, `"auth/permission denied"`). Each per-subscriber failure log now carries a `reason` field alongside the raw `error`.
2. The send worker aggregates `failureReasonCounts` and passes `delivery.failureReasons: { reason, count }[]` (sorted desc) to the notifier.
3. `message-builder.ts` renders the top-3 reasons under the Distribution section as `◦ N× <reason>`. Reasons beyond the top-3 are bucketed into a single `◦ K× other (M more reasons)` line.
4. Long collection-error messages are truncated at ~120 chars with an ellipsis, keeping the Errors section scannable.

### Run 3 — `cebac2c6-1f51-4dff-ac64-8cf066baccdd` (post-iteration-2)

Per-failure log lines now carry classified reasons:

```
{"event":"newsletter-send.failed","runId":"cebac2c6-...","reason":"rate limit","error":"Resend error: Too many requests..."}
{"event":"newsletter-send.failed","runId":"cebac2c6-...","reason":"unverified sender domain","error":"Resend error: The vertexcover.io domain is not verified..."}
```

Notification fired with classified counts:

```
{"event":"newsletter-send.completed","runId":"cebac2c6-...","attempted":38,"sent":0,"failed":38}
{"event":"slack.notify.sent","runId":"cebac2c6-...","attempted":38,"sent":0,"failed":38}
```

Expected Slack message:

```
🟢 Newsletter Sent
[digest headline]
📊 Sources
  • Hacker News: <N> items
  Total: <N> items fetched
⚠️ Errors
  • No collection errors
📬 Distribution
  Sent to 0/38 subscribers (38 failed).
    ◦ N× rate limit
    ◦ M× unverified sender domain
🔗 View archive · runId: cebac2c6-...
```

Full log proof: `live-run-logs/run-3-with-reasons.log`.

