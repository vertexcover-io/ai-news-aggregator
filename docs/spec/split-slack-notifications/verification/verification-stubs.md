# Verification Stubs (for VS-0 fold-in)

No new external integrations to re-prove at verify time. All four new Slack
messages exercise the same transport (`postToWebhook`) and Block Kit shape
that the existing combined message already uses in production.

VS-0 scenarios reduce to:

- **VS-0.1** — The webhook URL POST body shape matches the existing
  `notifier.test.ts` golden expectations for all four new builders.
- **VS-0.2** — On HTTP 200 the notifier writes the appropriate
  `notification_state` key; on HTTP 4xx/5xx the key is NOT written
  (no-marker-on-fail rule).

Both are covered by the new builder unit tests + the existing
`notifyWithMarker` happy/failure path tests (already proven for
`notifyReviewPending` etc.).
