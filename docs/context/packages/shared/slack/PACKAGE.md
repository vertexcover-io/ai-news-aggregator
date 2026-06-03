---
governs: packages/shared/src/slack/
last_verified_sha: 40c6b83
key_files: [notifier.ts, webhook-client.ts, message-builder.ts, types.ts, builders/_helpers.ts, builders/collector-health.ts]
flow_fns: [notifier.ts::createSlackNotifier, webhook-client.ts::postToWebhook]
decisions: [D-107, D-111]
status: active
---

# slack/ — Slack notification system (notifier factory, message builders, webhook client)

## Purpose
Complete Slack notification layer: SlackNotifier interface with 11 methods, factory with idempotency and dry-run gating, pure message builders per notification type, and thin webhook POST client.

## Public surface
- createSlackNotifier(deps) → SlackNotifier — factory with idempotency via notification_state JSONB + dry-run gating; returns no-op when webhookUrl is unset
- postToWebhook({ url, blocks, fetchFn? }) → WebhookPostResult — POSTs blocks as JSON
- Message builders: buildSourceDistributionMessage, buildEmailDeliveryMessage, buildLinkedinPostedMessage, buildTwitterPostedMessage, buildPublishFailedMessage, buildPublishUnavailableMessage, buildReviewPendingMessage, buildReviewWarningMessage, buildSubscriberConfirmedMessage, buildSubscriberRemovedMessage, buildReviewedMessage (deprecated)
- buildCollectorHealthMessage({ failures, trigger }) → `{ blocks }` — ONE consolidated message: header `🔴 Collector health check failed (<scheduled|manual>)` + a single section block with one bullet per failed collector (`<collector>: <reason>`, each reason truncated to 120 chars). No archive context block, no `notification_state` marker — fires for both triggers every time (D-111). Posted directly via `postToWebhook` by the collector-health worker, NOT through `createSlackNotifier`'s idempotency path.
- Builder helpers (_helpers.ts): headerBlock, sectionMarkdown, contextMarkdown, statusSuffix, truncate, renderPermalink, archiveContextLine

## Depends on / used by
Uses: pino (Logger type only), @shared/types/notifications
Used by: pipeline (creates notifier, calls after each stage), api (subscriber notifications)

## Data flows
createSlackNotifier(deps) → SlackNotifier:
  !webhookUrl → no-op notifier (all methods Promise.resolve())
  notifyWithMarker({ runId, key, blocks }):
    archive.findById → null/dryRun/alreadyNotified? → return
    postToWebhook → ok? → markNotification(runId, key) → return
    fail? → warn (do NOT write key → retryable)

postToWebhook({ url, blocks }) → WebhookPostResult:
  fetch(url, { method: POST, body: JSON.stringify({ blocks }) })
    ├─ network error → { ok: false, status: "network" }
    └─ response → status 200 + body "ok" → { ok: true } : { ok: false }

## Gotchas / landmines
1. Idempotency is per-key: failure to POST doesn't write key → retry re-sends (correct — duplicate beats missed)
2. No-op notifier silently swallows all calls when SLACK_WEBHOOK_URL unset
3. Subscriber notifications have no idempotency (fire-and-forget)
4. buildReviewedMessage is deprecated — use split messages instead
5. **`buildCollectorHealthMessage` bypasses the notifier's idempotency** (D-111): it is called directly by the collector-health worker + `postToWebhook`, NOT via `createSlackNotifier`/`notifyWithMarker`. Health checks have no run/archive to carry a `notification_state` marker, so the message intentionally re-fires on every failed check (manual or scheduled). This is the deliberate counterpoint to D-107.
