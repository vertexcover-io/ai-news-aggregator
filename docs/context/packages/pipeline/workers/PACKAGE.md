---
governs: packages/pipeline/src/workers/
last_verified_sha: 40c6b83
key_files: [processing.ts, run-process.ts, daily-run.ts, email-send.ts, linkedin-post.ts, twitter-post.ts, social-health.ts, collector-health.ts, publish-target.ts, newsletter-send.ts, collection.ts]
flow_fns: [processing.ts::createProcessingWorker, run-process.ts::handleRunProcessJob, daily-run.ts::handleDailyRunJob, email-send.ts::handleEmailSendJob, linkedin-post.ts::handleLinkedInPostJob, twitter-post.ts::handleTwitterPostJob, collector-health.ts::handleCollectorHealthJob, publish-target.ts::resolvePublishTarget]
decisions: [D-050, D-051, D-052, D-110, D-111]
status: active
---

# workers/ — BullMQ job handlers that orchestrate the pipeline stages

## Purpose
Each worker file exports a handler function called by the dispatching `processing.ts` Worker. Handlers coordinate repository reads, processor calls, service interactions, and archive finalization. Business logic lives in processors/services; workers wire them together.

## Public surface
- `createProcessingWorker(options?)` → `Worker` — single dispatching worker routing by `job.name` (run-process, daily-run, email-send, linkedin-post, twitter-post, social-health)
- `createRunProcessWorker(options?)` → `Worker` — standalone run-process worker (testable with injected deps)
- `handleRunProcessJob(deps, job)` → `RunProcessResult` — 4-stage pipeline: collect → dedup → shortlist → rank; writes archive + Slack on success/failure/cancel
- `handleDailyRunJob(deps, job)` → `void` — loads settings, calls `startRun()`, enqueues `run-process`
- `handleEmailSendJob(deps, job)` → `void` — resolves target, renders newsletter HTML, sends to subscribers with rate-limited pacing + retry
- `handleLinkedInPostJob(deps, job)` → `void` — resolves target, posts to LinkedIn, fires Slack on success/failure
- `handleTwitterPostJob(deps, job)` → `void` — resolves target, posts to X/Twitter, fires Slack on success/failure
- `handleSocialHealthJob(deps, job)` → `void` — validates Twitter credentials, alerts Slack on failure
- `createCollectorHealthWorker(options?)` → `Worker` — **dedicated** worker on the `collector-health` queue (own Redis connection), separate from the processing worker (D-110); never set to `concurrency:1`
- `handleCollectorHealthJob(deps, job)` → `void` — resolves targets (payload collectors, or all enabled from settings), runs each strategy under `Promise.allSettled` (one failure never aborts others, REQ-010), persists per-collector terminal result to Redis, posts ONE consolidated Slack message on any failure (D-111)
- `buildDefaultCollectorHealthDeps()` → `CollectorHealthJobDeps` — wires the default deps incl. the per-job `buildHealthCheckDeps` factory (D-051 pattern — Twitter cookie + Tavily key resolved per job, never at worker construction)
- `handleNewsletterSendJob(deps, job)` → `void` — **@deprecated** legacy combined email+social send; kept for back-compat
- `resolvePublishTarget(deps, input)` → `PipelineRunArchiveRow | null` — resolves the archive to publish (by runId or latest terminal), validates reviewed/non-dry-run
- `handleCollectionJob(job, deps?)` → `CollectorResult` — **legacy** per-source collection worker (kept for rollback)

## Depends on / used by
- Uses: all processors, all collectors, all repositories, all services, `bullmq`, `@newsletter/shared`
- Used by: `src/index.ts` (process entrypoint), `@newsletter/api` (via queue enqueue)

## Data flows

### handleRunProcessJob(deps, job) → RunProcessResult
  job.data { runId, topN, sourceTypes, collectors, halfLifeHours, dryRun }
    → createRunLogger → createCostTracker → create AbortController
      → cancelSubscriber.subscribe(runId) [Redis pub/sub]
        → re-check Redis state (cancelling → abort early)
          → Stage 1: collecting
            ├─ runCollecting: Promise.all over collector tasks (hn, reddit, web, twitter, webSearch)
            │   → each task: collectorFn → writeSerial(updateSource) → runLog
            │   → if CancelledError thrown → re-throw (caught by outer cancel handler)
            ├─ all collectors failed → writeFailedArchive → persistCost → return { rankedCount: 0 }
            └─ partial/full success → continue
          → Stage 2: processing (dedup)
            ├─ loadCandidatesSince (by run-started-at window)
            ├─ getPublishedCanonicalUrls (covered-link filter) → filter already-published
            ├─ dedupCandidates → runLog stage.result
            └─ candidates empty → write completed archive (0 items)
          → Stage 3: shortlisting
            ├─ load userSettings (per-job, for prompt freshness)
            ├─ shortlistFn(candidates, { shortlistSize, systemPrompt }) → runLog stage.result
            └─ shortlist empty → write completed archive
          → Stage 4: ranking
            ├─ rankFn(shortlist, { topN, systemPrompt, tracker }) → runLog stage.result
            ├─ updateRecapData (write recap content to raw_items.metadata.recap)
            ├─ buildSourceTelemetry → compute digestHeadline/digestSummary
            ├─ resolveScheduledPublishAt → publishedAt
            ├─ archiveRepo.upsert (completed, rankedItems, runFunnel, shortlistedItemIds, preReviewSnapshot)
            ├─ persistCost
            ├─ slackNotifier.notifySourceDistribution (idempotent)
            └─ if !autoReview → slackNotifier.notifyReviewPending
    → catch CancelledError: write cancelled archive + persistCost
    → catch other: writeFailedArchive + runLog.error + re-throw
    → finally: subscriber.close()

### resolvePublishTarget(deps, { channel, runId? }) → PipelineRunArchiveRow | null
  runId provided:
    → archiveRepo.findById(runId)
      ├─ null → return null
      ├─ isDryRun → log skip → return null
      ├─ !reviewed → slackNotifier.notifyPublishFailed("not_reviewed") → return null
      └─ ok → return archive
  runId absent:
    → archiveRepo.findLatestTerminal()
      ├─ null → slackNotifier.notifyPublishUnavailable("no_archive") → return null
      ├─ isDryRun / status != "completed" / !reviewed → slack alert + return null
      └─ ok → return archive

### handleEmailSendJob(deps, job) → void
  job.data { runId?, subscriberIds? }
    → resolvePublishTarget
      ├─ broadcast (subscriberIds="all"): check emailSentAt → return if already sent
      └─ targeted: no broadcast guard check
    → hydrateItems (resolve recap overrides, pickSummarySource for source labeling)
    → listConfirmed / findByIds → filter already-sent (email_sends table)
    → chunk(batch=50) → for each batch:
        Promise.allSettled over subscribers:
          → renderNewsletter → pacer.acquire()
            → retry loop (max 2):
              ├─ emailProvider.send → emailSendsRepo.create → okCount++
              ├─ retryable error + attempts < 2 → sleep(backoffMs) → retry
              └─ non-retryable / exhausted → classifyDeliveryFailure → failCount++
    → broadcast only: archiveRepo.markEmailSent + slackNotifier.notifyEmailDelivery

### handleCollectorHealthJob(deps, job) → void
  job.data { collectors?, trigger: "manual"|"scheduled" }
    → userSettingsRepo.get() [DB]
      ├─ settings.get() throws → set("failed", reason=err) for any payload collectors → rethrow  (so manual targets never stay stuck "running")
      ├─ payload.collectors non-empty → targets = payload (explicit; allowed even if disabled, EDGE-013)
      └─ else → targets = resolveEnabledCollectors(settings) (blog ⇐ webEnabled; "Check all")
    → targets empty → log collector_health.no_targets → return  (EDGE-001 enqueued:[])
    → trigger==="scheduled" → store.setRunning(c,"scheduled",now) per target  (manual already set running by the API route; D-110/AD-3)
    → buildHealthCheckDeps()  (per-job: resolveTwitterCollectorCookie DB-first/env + TAVILY_API_KEY; D-051)
      └─ throws → set("failed") for all targets → rethrow  (no stuck "running")
    → Promise.allSettled over targets:  (REQ-010 isolation)
        each: runCollectorHealthCheck(collector, settings, deps) → CollectorHealthOutcome
          ├─ resolves → store.set({status: healthy|failed, durationMs, reason, detail}) [Redis collector-health:<c>, no TTL]
          └─ throws → store.set({status:"failed", reason:err.message})
    → collect failures[] (status==="failed")
      ├─ failures empty OR SLACK_WEBHOOK_URL unset → return  (D-111 no-op)
      └─ else → buildCollectorHealthMessage({failures,trigger}) → postToWebhook  (D-111: ONE consolidated msg, no notification_state marker, fires for both triggers)
            └─ non-2xx / throw → log warn slack.collector_health.failed, never rethrow

## Gotchas / landmines
- **`email_sent_at` is broadcast-only**: Targeted welcome sends (subscriberIds: [id]) must NOT set this marker. The `isBroadcast` guard in `handleEmailSendJob` short-circuits before stamping. (D-050)
- **`publishDeps` built per-job, not at startup**: `buildDefaultPublishDeps()` is called inside the worker processor, not during worker construction. This fulfills the "admin credential save takes effect on next job without restart" contract. (D-051)
- **`newsletter-send.ts` is deprecated**: The legacy combined email+social worker (`handleNewsletterSendJob`) uses a hard-coded 5/s pacer (no retry), the old single-message Slack notifier, and has the `classify-then-count` key-mismatch bug (`failureReasonCounts.set(rawMessage, ...)` instead of `set(reason, ...)`). The active path is split across `email-send.ts`, `linkedin-post.ts`, `twitter-post.ts`. (D-052)
- **Collector-health worker is dedicated, not the processing worker** (D-110): `createCollectorHealthWorker` runs on the `collector-health` queue with its own `createRedisConnection()`. Do NOT route health checks through the processing worker or set it to `concurrency:1` — that anti-pattern (`queue-concurrency-vs-in-process-pacer.md`) would serialize every job type behind a multi-minute run.
- **Manual vs scheduled `running` ownership** (AD-3): the API route writes `running` synchronously for a manual check before enqueue; the worker only writes `running` for the `scheduled` trigger. A `buildHealthCheckDeps` throw after `setRunning` writes `failed` for all targets so nothing is stuck `running`.
- **Health-check Slack has no idempotency marker** (D-111): unlike run-bearing Slack (D-107), the consolidated collector-health failure message fires every time on both manual and scheduled failures — there is no `notification_state` (no run to attach it to). A re-checked still-broken collector re-alerts; this is intended.

## Decisions
- **D-050**: `email_sent_at` is the broadcast idempotency marker, not per-recipient. Why: per-recipient dedup belongs on the `email_sends` table. A targeted send stamping `email_sent_at` would poison the next broadcast. Tradeoff: two dedup mechanisms (archive-level for broadcast, send-level for per-recipient). Governs: `workers/email-send.ts`.
- **D-051**: Publish deps are per-job closures not constructor singletons. Why: design doc §3+§4.4 promises credential changes take effect on next job without restart. Tradeoff: one DB read per job for social credentials (acceptable). Governs: `workers/processing.ts::buildDefaultPublishDeps`.
- **D-052**: `newsletter-send.ts` is kept for back-compat only; not on the active dispatch path. Why: split into dedicated email-send, linkedin-post, twitter-post workers with independent idempotency + Slack messages. Tradeoff: dead code carrying a known bug (classify-then-count key mismatch). Governs: `workers/newsletter-send.ts`.
