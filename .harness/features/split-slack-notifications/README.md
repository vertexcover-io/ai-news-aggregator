# Split Slack Notifications

**Final verdict:** ✅ **PASSED** — see [`verification/proof-report.md`](verification/proof-report.md).

**PR:** [vertexcover-io/ai-news-aggregator#174](https://github.com/vertexcover-io/ai-news-aggregator/pull/174)

## Summary

Split the single combined `🟢 Newsletter Sent` Slack message — which today
bundles source telemetry, collection errors, email delivery counts, and
social-post results into one notification fired after email delivery — into
**four independent messages**, each posted by the worker whose stage produces
its data:

1. **`📊 Sources collected`** — fires from the `run-process` worker
   immediately after the ranking step writes `run_archives`, carrying
   per-source item counts + collection errors. Independent of `autoReview`.
2. **`📬 Newsletter emailed`** — fires from the `email-send` worker after
   subscriber delivery, carrying attempted/sent/failed counts + top-3
   classified failure reasons.
3. **`🟢 LinkedIn posted`** — fires from the `linkedin-post` worker on a
   successful post (suppressed on skip / already-posted / failed /
   null-permalink).
4. **`🟢 X (Twitter) posted`** — symmetric.

Each message is idempotent via a dedicated key in
`run_archives.notification_state` JSONB (`sourceDistribution`,
`emailDelivery`, `linkedinPosted`, `twitterPosted`). The legacy
`notifyNewsletterSent` method and the dead
`packages/pipeline/src/workers/newsletter-send.ts` worker are kept and
marked `@deprecated` for backwards compat — no migration of
`run_archives.slack_notified_at`.

## Table of contents

| Artifact | Purpose |
|----------|---------|
| [`design.md`](design.md) | Problem statement, alternatives considered, chosen architecture, risks |
| [`library-probe.md`](library-probe.md) | External-dep verdict (Slack Webhook — `VERIFIED_BY_EXISTING_USAGE`) |
| [`spec.md`](spec.md) | 17 EARS requirements + 16 verification scenarios + REQ→VS matrix |
| [`plan.md`](plan.md) | 3-phase implementation plan with file-level scope |
| [`learnings.md`](learnings.md) | Pipeline learnings (classify-then-count key bug, gate quirks for backend PRs, when bespoke flows beat helper generalization) |
| [`verification/proof-report.md`](verification/proof-report.md) | Final verdict: REQ→VS→test mapping, gate results |
| [`verification/adversarial-findings.md`](verification/adversarial-findings.md) | 10 break-it scenarios attempted; no new defects beyond review fixes |

## Library probe

- **Selected:** Slack Incoming Webhooks (already in production use)
- **Alternatives in chain:** Slack Web API (`chat.postMessage`) → no-op
  graceful degradation (existing) → other transports
- **Verdict:** `VERIFIED_BY_EXISTING_USAGE` (no new transport surface; same
  Block Kit schema, same `postToWebhook` client, same auth)

## Linear

Tracked under the AI Newsletter project (team key: VER). Linear issue ID
(VER-XX) to be referenced in PR title once the issue is filed.
