---
last_verified_sha: ad0153a
status: active
---

# Architecture — system shape, boundaries, and layer descent

## System shape

```
┌──────────────────────────────────────────────────────────┐
│                        web (React + Vite)                │
│              Public archive + Admin dashboard            │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP (REST + SSE)
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    api (Hono REST API)                   │
│       Auth, job enqueueing, settings, review, email      │
└───────┬──────────────────────────────────┬───────────────┘
        │ PostgreSQL (Drizzle ORM)         │ Redis (BullMQ + pub/sub)
        ▼                                  ▼
┌──────────────────────────────────────────────────────────┐
│                  pipeline (BullMQ Workers)               │
│    Collectors → Dedup → Shortlist → Rank → Publish       │
│   (4 workers: collection, processing, collector-health, alert-delivery)  │
└──────────────────────────────────────────────────────────┘
        │                                  │
        └── shared (DB schema, types,     │
             constants, services, slack)   │
                                           ▼
                              External APIs (LinkedIn, X, Resend, SES, Slack)
```

## Package boundaries

| Boundary | Rule | Enforced by |
|----------|------|-------------|
| api → pipeline | No static imports; dynamic `import()` only at route boundary | `eslint: no-restricted-imports` |
| pipeline → api | Pipeline has no HTTP framework; no Hono/Express | `eslint: no-restricted-imports` |
| web → shared | Subpath imports only (`@newsletter/shared/types`); never root barrel | Convention (learnings rule) |
| web → DB | No direct DB access; all data via API calls | `eslint: no-restricted-imports` (drizzle-orm blocked) |
| repo layer | Only repositories import `drizzle-orm` or `@newsletter/shared/db` | `eslint: newsletter/enforce-repository-access` |
| collector shape | All collectors return `CollectorResult` | `eslint: newsletter/collector-return-shape` |

## Layer descent traces

### HTTP request (public)
```
GET /api/archives/:runId →
  Hono router → route handler (archives.ts) →
    validate runId (zod) → archiveRepo.findById →
    PostgreSQL: SELECT run_archives WHERE id = $1 →
    hydrateRankedItems → build RankedItem[] with recap + previews →
    JSON response
```

### HTTP request (admin)
```
GET /api/admin/runs/:runId/observability →
  Hono router → requireAdmin middleware:
    getCookie("admin_session") → verifyToken → 401? | next() →
  route handler (admin-runs.ts) →
    buildRunObservability(runId, deps):
      Promise.all: redis.get(run:<id>), archiveRepo.findById, runLogRepo.listForRun →
      live? → deriveFunnelFromLogs | composeHistoricalFunnel →
      compose RunObservability → JSON response
```

### Job dispatch (api → pipeline)
```
POST /api/runs/now →
  route handler (runs.ts) → loadUserSettings →
  startRun(settings, redis, queue):
    write Redis run-state (run:<uuid>) →
    queue.add("processing", { name: "run-process", data: { runId, ... } }, { jobId: runId }) →
  pipeline Worker picks up job → handleRunProcessJob →
    4-stage pipeline: collect → dedup → shortlist → rank →
    finalizeRun (services/finalize-run.ts): write run_archives → Slack notify → cost persist
```

### Settings save → next job freshness
```
PUT /api/settings →
  route handler (settings.ts) → validate (zod transform + superRefine) →
  userSettingsRepo.upsert(input: UserSettings) → PostgreSQL →
  reconcilePipelineSchedule(queue, settings):
    upsertJobScheduler for pipeline-run, social-health, email-send, linkedin-post, twitter-post →
  reconcileCollectorHealthSchedule(collectorHealthQueue, settings):  (D-110: dedicated queue)
    upsertJobScheduler(COLLECTOR_HEALTH_SCHEDULER_KEY, pipelineTime − 30min) →
  next pipeline job: userSettingsRepo.get() → reads fresh rankingPrompt, shortlistPrompt
```

### Admin review save → immediate publish
```
PATCH /api/admin/archives/:runId →
  route handler (archives.ts) → patchArchive(runId, input):
    validate rankedItemIds → diffReview(snapshot, patch) →
    atomic transaction: review_edits.replaceForRun + archive.updateRankedItems →
    selectImmediatePublishChannels({ settings, completedAt, now }) →
    for each past-due channel: queue.add(channel, { runId }, { delay: 0 }) →
  pipeline worker picks up: handleLinkedInPostJob / handleTwitterPostJob / handleEmailSendJob
```

### Cancel run (api → pipeline via Redis pub/sub)
```
POST /api/runs/:runId/cancel →
  route handler (runs.ts) → cancelRun(runId):
    redis.get(run:<id>) → parse RunState →
    validate cancellable → set status="cancelling" →
    publisher.publish("run:cancel:<runId>", "") →
  pipeline worker's CancelSubscriber receives message →
  AbortSignal fires → collectors abort mid-stage →
  write cancelled archive + persistCost
```
