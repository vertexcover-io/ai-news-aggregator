---
last_verified_sha: 8f2bc3411177651bbd5e223a7aba4b77be130474
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
      Finalize: finalizeRun(deps, args) (pipeline/services/finalize-run.ts — extracted in 060ba1c)
        → archiveRepo.upsert → PostgreSQL run_archives
        → resolveScheduledPublishAt → run_archives.published_at
        → persistCost → run_archives.cost_breakdown
        → createSlackNotifier → notifySourceDistribution (idempotent via notification_state)
        → if !autoReview: notifyReviewPending
        → evaluateRunHealth(runId, collectorOutcomes, alertingDeps) (best-effort; D-116/NF1)
            → alertDispatcher.capture per failed/degraded collector → PostgreSQL incidents
        (failure/cancel paths: writeFailedArchive / pickArchiveDigest in services/run-archive-writer.ts)
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
  → reconcileCollectorHealthSchedule(collectorHealthQueue, saved) (api/services/scheduler.ts)  (D-110: sibling reconcile, DEDICATED queue)
    → !scheduleEnabled → removeJobScheduler(COLLECTOR_HEALTH_SCHEDULER_KEY)
    → scheduleEnabled → upsertJobScheduler(COLLECTOR_HEALTH_SCHEDULER_KEY, cron = pipelineTime − 30min, tz)
  Detail: api/routes/PACKAGE.md § Data flows, api/services/PACKAGE.md § Data flows
```

## Incident capture + alert delivery

```
[capture path — triggered at pipeline finalize]
evaluateRunHealth(runId, collectorOutcomes, deps) (shared/alerting/run-health.ts)
  → for each failed/degraded collector outcome:
      alertDispatcher.capture({ category, source, signature, severity, title, ... })
        → incidentsRepo.upsertByFingerprint(fingerprint, input) → PostgreSQL incidents
            (ON CONFLICT fingerprint: increment occurrences, update last_seen; D-115)
            → returns { incident, shouldNotify }  (shouldNotify from pre-update notified_at; D-118)
          ├─ severity=info OR status=muted → return (no send)
          ├─ !shouldNotify (within cooldown) → return
          └─ channel.enabled → channel.send(incident)
              ├─ ok → incidentsRepo.markDelivered(id, now) (advances notified_at; D-118)
              └─ fail → incidentsRepo.incrementDeliveryAttempts(id)
        (wrapped in try/catch — NEVER throws; D-116/NF1)
  Detail: shared/alerting/PACKAGE.md § Data flows, pipeline/services/PACKAGE.md

[sweep path — BullMQ repeatable ALERT_DELIVERY_SCHEDULER_KEY, every ALERT_SWEEP_INTERVAL_MS]
runAlertDeliverySweep(deps) (pipeline/workers/alert-delivery.ts)
  → incidentsRepo.listUndelivered() → PostgreSQL incidents (status=open, delivered_at=null)
  → Promise.allSettled over undelivered:
      channel.send(incident)
        ├─ ok → incidentsRepo.markDelivered(id, now)
        └─ fail → incidentsRepo.incrementDeliveryAttempts(id)
  → never throws (errors logged, swallowed; D-117)
  Detail: pipeline/workers/PACKAGE.md § Data flows

[admin UI path]
GET /api/admin/incidents (api/routes/admin-incidents.ts)  [admin-gated]
  → incidentsRepo.list({ status?, severity? }) → PostgreSQL incidents
  → 200 [Incident[]]
PATCH /api/admin/incidents/:id/status (api/routes/admin-incidents.ts)  [admin-gated]
  → z.enum(["resolved","muted"]).parse(body.status)  (SQL-injection guard)
  → incidentsRepo.setStatus(id, status) → PostgreSQL incidents
  → queryClient.invalidateQueries(["admin","incidents"]) (web/pages/AdminIncidentsPage.tsx)
  Detail: api/routes/PACKAGE.md, web/pages/PACKAGE.md
```

## Collector health check (manual + scheduled)

```
[manual] POST /api/admin/collector-health/check (api/routes/collector-health.ts)  [admin-gated, REQ-023]
  → checkBodySchema.safeParse → targets = [collector] | enabledCollectors(settings) | []
  → store.setRunning(c,"manual",now) per target → Redis collector-health:<c> (status:running, NO TTL)
  → targets>0 → collectorHealthQueue.add("collector-health", { collectors, trigger:"manual" }) → 202 {enqueued}
[scheduled] BullMQ repeatable COLLECTOR_HEALTH_SCHEDULER_KEY fires (pipelineTime − 30min)
  → collectorHealthQueue job { trigger:"scheduled" } (no collectors → all enabled)
        ↓ (dedicated collector-health Worker, NOT processing; D-110)
  handleCollectorHealthJob (pipeline/workers/collector-health.ts)
    → trigger==="scheduled" → store.setRunning per target  (manual already running via the route)
    → buildHealthCheckDeps() per-job (Twitter cookie DB-first/env + TAVILY key; D-051)
    → Promise.allSettled: runCollectorHealthCheck(c, settings, deps)  (REQ-010 isolation)
        → per-collector probe (Algolia / Reddit RSS / rettiwt / crawl-only blog / Tavily)
        → store.set({status:healthy|failed, durationMs, reason, detail}) → Redis collector-health:<c> (NO TTL)
    → failures>0 AND SLACK_WEBHOOK_URL set → buildCollectorHealthMessage → postToWebhook  (D-111: ONE msg, no marker, both triggers)
        ↓ (UI reads back)
  useCollectorHealth() (web/hooks) polls GET /api/admin/collector-health → store.getSnapshot() → 5 entries
    → CollectorHealthModal renders running→healthy|failed; refetchInterval=false once none running (REQ-019)
  Detail: api/routes/PACKAGE.md § Data flows, pipeline/workers/PACKAGE.md § Data flows,
          pipeline/services/PACKAGE.md § runCollectorHealthCheck, web/hooks/PACKAGE.md
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
