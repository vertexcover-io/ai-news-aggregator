# Verification Stubs (from Library Probe)

These probe scenarios MUST be re-verifiable at functional-verify time. They are folded into `spec.md` as VS-0.* scenarios.

## VS-0.1 — Webhook accepts Block Kit payload

**Probe artifact:** `probes/slack-webhook.mjs`

**Live result (2026-05-07):** `{ status: 200, body: "ok", ms: 458 }` ✅

**Reproducible:**
```bash
SLACK_WEBHOOK_URL=<webhook> node docs/spec/slack-notify-on-reviewed/probes/slack-webhook.mjs
```
Exit code 0 = pass.

## VS-0.2 — Non-200 response handled gracefully

**Setup:** Mock `fetch` to return `new Response("invalid_payload", { status: 400 })`.

**Assertion:** `notifier.notifyReviewedArchive(...)` resolves (does NOT throw); logger received an error event with `event: "slack.notify.failed"` and `status: 400`.

## VS-0.3 — Webhook URL is never logged in plaintext

**Setup:** Run notifier with a webhook URL containing a known unique secret token. Capture all logger output during a successful and a failed notification.

**Assertion:** No log entry contains the full URL or the secret path segment. Only the host (`hooks.slack.com`) and HTTP status appear in logs.

## VS-0.4 — Idempotency

**Setup:** Archive row already has `slackNotifiedAt` set. Call `notifyReviewedArchive(runId)`.

**Assertion:** No HTTP request issued. Logger receives an info event with `event: "slack.notify.skipped"` and `reason: "already_notified"`.

## VS-0.5 — Disabled when env unset

**Setup:** `createSlackNotifier({ webhookUrl: undefined, ... })`.

**Assertion:** Returned notifier's `notifyReviewedArchive` is a no-op (resolves immediately, no fetch call).
