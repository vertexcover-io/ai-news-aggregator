---
last_verified_sha: 5a2ff20
status: active
---

# Data flows — cross-package, end-to-end traces

Each flow traces data from its entry point across every package hop to its terminal output.

## Daily pipeline run

```
handleDailyRunJob (pipeline/workers/daily-run.ts)
  → load userSettings from PostgreSQL
  → startRun(settings, redis, queue) (shared/src/run-start.ts):
      write Redis run-state (run:<uuid>)
      queue.add("processing", { name: "run-process", data: { runId, topN, ... } })
  → handleRunProcessJob (pipeline/workers/run-process.ts):
      Stage 1: collect
        → Promise.allSettled over collectors: hn, reddit, web, twitter, webSearch
          → each: fetch → map to RawItemInsert[] → rawItemsRepo.upsertItems → PostgreSQL
          → inline link enrichment (EnrichmentContext with per-run URL cache)
      Stage 2: dedup
        → loadCandidatesSince (PostgreSQL)
        → getPublishedCanonicalUrls (exclude already-published)
        → dedupCandidates (URL-canonical, highest-engagement survivor)
      Stage 3: shortlist
        → userSettingsRepo.get() (re-read per-job for prompt freshness)
        → shortlistCandidates(candidates, { shortlistSize, systemPrompt })
          → Claude Haiku 4.5 LLM: pick top-N IDs by title
      Stage 4: rank
        → rankCandidates(shortlist, { topN, systemPrompt, tracker })
          → Claude Haiku LLM: rerank + produce recap per item + digest headline/summary
        → updateRecapData → PostgreSQL raw_items.metadata.recap
      Finalize:
        → archiveRepo.upsert → PostgreSQL run_archives
        → resolveScheduledPublishAt → run_archives.published_at
        → persistCost → run_archives.cost_breakdown
        → createSlackNotifier → notifySourceDistribution (idempotent via notification_state)
        → if !autoReview: notifyReviewPending
  Detail: pipeline/workers/PACKAGE.md § Data flows, pipeline/processors/PACKAGE.md § Data flows
```

## Email send flow

```
handleEmailSendJob (pipeline/workers/email-send.ts)
  → resolvePublishTarget → archiveRepo.findById (PostgreSQL)
  → hydrateItems → recap overrides + pickSummarySource
  → listConfirmed subscribers (PostgreSQL)
  → filter already-sent (PostgreSQL email_sends)
  → chunk (batch=50) → for each subscriber:
      renderNewsletter → React Email JSX → HTML string
      pacer.acquire() (shared SendPacer singleton)
      retry loop (max 2):
        emailProvider.send → Resend/SES API
          ├─ ok → emailSendsRepo.create → PostgreSQL
          └─ retryable error → sleep(retryAfterMs) → retry
  → broadcast only: archiveRepo.markEmailSent + slackNotifier.notifyEmailDelivery
  Detail: pipeline/workers/PACKAGE.md § Data flows
```

## Social post flow (LinkedIn / X)

```
handleLinkedInPostJob (pipeline/workers/linkedin-post.ts)
  → resolvePublishTarget → archiveRepo.findById
  → credential-resolver → socialCredentialsRepo.getLinkedIn →
      DB-first (encrypted) / env-fallback
  → composeLinkedInMessage(digestHeadline, hook, rankedItems)
  → apiClient.createPost(accessToken, personUrn, text)
    ├─ ok → apiClient.createComment(accessToken, personUrn, postUrn, archiveLink)
    └─ duplicate → skip (already posted by earlier run)
  → archiveRepo.markLinkedInPosted(postedAt, postUrn, permalink)
  → slackNotifier.notifyLinkedinPosted
  Detail: pipeline/workers/PACKAGE.md § Data flows, pipeline/social/linkedin/PACKAGE.md § Data flows
```

## Admin review save → immediate publish

```
PATCH /api/admin/archives/:runId (api/routes/archives.ts)
  → archivePatchSchema.parse (zod)
  → patchArchive(runId, input, deps) (api/services/review.ts)
    → archiveRepo.findById → validate IDs
    → diffReview(snapshot, patch) (shared/review-edits/diff.ts)
    → atomic transaction: review_edits.replaceForRun + archive.updateRankedItems
    → compute effective headline/summary → serializeArchiveSearchText → search_text
  → selectImmediatePublishChannels({ settings, completedAt, now }) (shared/scheduling/immediate-publish.ts)
    → for each past-due channel not already sent:
        queue.add(channel, { runId }, { jobId, delay: 0 })
  → pipeline worker picks up: handleLinkedInPostJob / handleTwitterPostJob / handleEmailSendJob
  Detail: api/routes/PACKAGE.md § Data flows, api/services/PACKAGE.md § Data flows, shared/scheduling/PACKAGE.md § Data flows
```

## Subscriber confirm → welcome send

```
GET /api/confirm?token= (api/routes/subscribe.ts)
  → verifySubscriberToken(token, "confirm", secret) (api/lib/subscriber-token.ts)
    → HMAC verify → check type + expiry
  → updateStatus(subscriberId, "confirmed") (api/repositories/subscribers.ts)
    → WHERE status != "confirmed" → { changed: bool }
    → changed? → slackNotifier.notifySubscriberConfirmed
  → getMostRecentReviewedArchiveId
    ├─ exists → queue.add("processing", { name: "email-send", data: { runId, subscriberIds: [id] } })
    └─ null → skip
  → redirect /confirm?status=success
  Detail: api/routes/PACKAGE.md § Data flows, api/lib/PACKAGE.md § Data flows
```

## Settings save → schedule reconciliation

```
PUT /api/settings (api/routes/settings.ts)
  → userSettingsUpsertSchema.parse (zod transform + pipe + superRefine)
    → defaults missing times
    → resolves Twitter @handle → userId via rettiwt API
  → userSettingsRepo.upsert(input) → PostgreSQL
  → refreshPostHogConfig(saved) → invalidate 30s cache
  → reconcilePipelineSchedule(queue, saved) (api/services/scheduler.ts)
    → !scheduleEnabled → removeJobScheduler for all channels
    → scheduleEnabled → upsertJobScheduler for:
        pipeline-run at pipelineTime
        social-health at pipelineTime - 15min
        email-send at emailTime
        linkedin-post at linkedinTime
        twitter-post at twitterTime
  Detail: api/routes/PACKAGE.md § Data flows, api/services/PACKAGE.md § Data flows
```

## Slack notification idempotency

```
createSlackNotifier(deps) (shared/slack/notifier.ts)
  → each method follows notifyWithMarker pattern:
      1. archiveRepo.findById → null/dryRun/alreadyNotified? → return
      2. postToWebhook({ url, blocks }) → Slack webhook POST
         ├─ ok → markNotification(runId, key, now) → write notification_state JSONB key
         └─ fail → warn (do NOT write key → retry can re-alert)
  → notification_state keys: sourceDistribution, emailDelivery, linkedinPosted,
    twitterPosted, linkedinFailure, twitterFailure, reviewPending, reviewWarning
  Detail: shared/slack/PACKAGE.md § Data flows
```
