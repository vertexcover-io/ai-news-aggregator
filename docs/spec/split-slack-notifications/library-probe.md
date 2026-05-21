# Library Probe: split-slack-notifications

<!-- LP:VERDICT:PASS -->

## Summary

No new external libraries or APIs introduced. The feature reuses the
**Slack Incoming Webhooks** transport that the codebase already exercises in
production via `packages/shared/src/slack/webhook-client.ts::postToWebhook`
and the existing notifier methods (`notifyReviewPending`, `notifyReviewWarning`,
`notifyPublishFailed`, `notifyPublishUnavailable`, `notifyNewsletterSent`).

## Dependency table

| Library / API | Use cases | Auth | Verdict |
|---------------|-----------|------|---------|
| Slack Incoming Webhooks (`POST https://hooks.slack.com/...`) | Post Block Kit messages with `header` / `section` / `context` blocks | Webhook URL only (`SLACK_WEBHOOK_URL`) | **VERIFIED_BY_EXISTING_USAGE** |

### Why no live probe required

- The new code paths exercise the **same** transport, same JSON-body shape,
  same Block Kit schema (`header` + `section` + `context`) as the existing
  combined `buildReviewedMessage` and the four existing per-event builders
  in `packages/shared/src/slack/builders/`.
- The existing unit-tests already round-trip the builders through the
  notifier:
  - `packages/pipeline/tests/unit/workers/newsletter-send.test.ts`
  - `packages/pipeline/tests/unit/workers/email-send.test.ts`
  - `packages/shared/src/slack/*` (builder unit tests, where present)
- The new builders are structurally identical to the existing ones —
  composed of the same three block primitives produced by the same internal
  helpers (`headerBlock`, `sectionMarkdown`, `contextMarkdown`).
- The auth surface is unchanged: `SLACK_WEBHOOK_URL` is already loaded from
  `.env` in production and from `.env.harness` for tests.

## Fallback chain (declared in design.md §External Dependencies)

1. **Slack Incoming Webhook** — chosen, already in use.
2. **Slack Web API `chat.postMessage`** — would unlock threading; future PR.
3. **Skip Slack entirely** — `createSlackNotifier` already returns no-op methods
   when `SLACK_WEBHOOK_URL` is unset; this is the natural graceful-degradation
   fallback already wired in production.
4. **Different transport** (email, Discord webhook, custom HTTP callback) —
   only if Slack itself becomes unreliable; not in scope.

## Re-plan required

None.
