---
governs: packages/pipeline/src/services/
last_verified_sha: ad0153a
key_files: [run-state.ts, run-logger.ts, cost-tracker.ts, candidate-loader.ts, credential-resolver.ts, source-telemetry.ts, cancel-subscriber.ts, recency.ts, web-crawler.ts, add-post-helper.ts, build-pre-review-snapshot.ts, collector-health/index.ts, collector-health/classify.ts, run-archive-writer.ts, finalize-run.ts]
flow_fns: [run-state.ts::createRunStateService, run-logger.ts::createRunLogger, cost-tracker.ts::createCostTracker, credential-resolver.ts::resolveLinkedInCredentials, cancel-subscriber.ts::createCancelSubscriber, web-crawler.ts::runWebCrawl, add-post-helper.ts::hydrateAddedPost, collector-health/index.ts::runCollectorHealthCheck, run-archive-writer.ts::writeFailedArchive, run-archive-writer.ts::pickArchiveDigest, finalize-run.ts::finalizeRun]
decisions: [D-070, D-071, D-072]
status: active
---

# services/ — cross-cutting state, enrichment, and orchestration helpers

## Purpose
Services own state management (Redis run-state, cost tracking), candidate loading, credential resolution, source telemetry building, cancellation signaling, recency math, web crawling, and the add-post hydration flow. They are shared by workers but contain no BullMQ-specific code.

## Public surface
- `createRunStateService(redis)` → `RunStateService` — Redis read-modify-write wrapper for `run:{runId}` keys (get, set, update, updateSource, setStage)
- `createRunLogger(runId, { repo, logger })` → `RunLogger` — dual-emits log entries to `run_logs` table (best-effort) + Pino stdout (level methods: debug/info/warn/error)
- `withPinoBridge(runLogger, baseLogger)` → `RunLogger` — dual-emits to both a RunLogger and a base Pino logger
- `createCostTracker(runId)` → `CostTracker` — per-run LLM cost accumulator (record, snapshot, merge, hasAnyCalls)
- `createCancelSubscriber(connection)` → `CancelSubscriberFactory` — Redis pub/sub subscription for `run:cancel:{runId}` channel
- `loadCandidatesSince(repo, since, sourceTypes)` → `Candidate[]` — loads raw_items by collectedAt window, picks best body text
- `pickCandidateContent(content, metadata, enrichedLink?)` → `string | null` — picks best body (enriched markdown > native content > null)
- `resolveLinkedInCredentials(deps)` → `LinkedInCreds | null` — DB-first/env-fallback credential resolver
- `resolveTwitterOAuth1Credentials(deps)` → `TwitterOAuth1Creds | null` — DB-first/env-fallback for X/Twitter OAuth 1.0a
- `resolveTwitterCollectorCookie(deps)` → `TwitterCollectorCookie | null` — DB-first/env-fallback for Rettiwt cookies
- `buildSourceTelemetry(outcomes)` → `RunSourceTelemetry` — aggregate collector outcomes into per-source unit entries
- `runWebCrawl(jobs, opts)` → `Map<string, CrawlResult>` — Crawlee AdaptivePlaywrightCrawler wrapper (listing + detail)
- `hydrateAddedPost(url, sourceType, deps)` → `RankedItem` — single-item add-post: fetch → upsert → recap → merge cost
- `buildPreReviewSnapshot(args)` → `PreReviewSnapshot` — captures pre-review state of ranked items + digest meta
- `recencyDecay(ageHours, halfLifeHours)` → `number` — exponential decay factor for scoring
- `ageHoursFromPublishedAt(publishedAt, now?)` → `number` — hours since publish (null → 24h default)
- `engagementScore(points, commentCount)` → `number` — log-compressed engagement
- `collector-health/index.ts::runCollectorHealthCheck(collector, settings, deps)` → `CollectorHealthOutcome` — dispatches to the per-collector probe strategy (hn → Algolia search; reddit → subreddit RSS w/ bot UA; twitter → rettiwt authenticated read; blog → `runWebCrawl` crawl-only, **no LLM** EDGE-009; web_search → minimal Tavily query). Each runs under a per-collector timeout (blog 35s, twitter/web_search 15s, hn/reddit 10s), returns `{status:"healthy"|"failed", durationMs, reason, detail}`, and "not configured" short-circuits without a network call.
- `collector-health/classify.ts::classifyCollectorHealthError(collector, err)` → short human reason — maps thrown errors to auth / missing-secret / rate-limit / network-timeout / blocked / schema / unknown with priority ordering (reuses Twitter `classifyError` codes); raw error stays in the structured log only.
- `collector-health/classify.ts::classifyCollectorHealthToken(...)` → token-level classifier helper used by the strategies.

## Depends on / used by
- Uses: `ioredis`, `crawlee`, `@newsletter/shared`, `@pipeline/repositories`, `@pipeline/collectors`, `@pipeline/processors`, `@pipeline/services/link-enrichment`, `@pipeline/services/web-fetch`
- Used by: all workers, eval module

## Data flows

### hydrateAddedPost(url, sourceType, deps) → RankedItem
  url, sourceType → dispatchFetch(url, sourceType) → RawItemInsert
    → rawItemsRepo.upsertItems([withFlag { addedInReview: true }])
      → findBySourceAndExternalId → generateRecap (LLM)
        → rawItemsRepo.updateRecapData → tracker.merge(existing).snapshot()
          → archiveRepo.setCostBreakdown → toRankedItem → RankedItem
  (add-post cost is merged into existing archive cost breakdown)
  (recap generation uses standalone generateRecap, not the inline rank path)

### runWebCrawl(jobs, opts) → Map<string, CrawlResult>
  jobs → filter isCrawlableUrl → pre-fill results with sentinels
    → AdaptivePlaywrightCrawler (maxConcurrency, 3 retries, domcontentloaded + 4s networkidle chase)
      ├─ requestHandler: parseWithCheerio → convert(html, baseUrl, mode) → pushData
      ├─ failedRequestHandler: record error
      └─ resultChecker: isHealthyResult + hasListingPostLinks (listing mode)
    → on abort: tear down crawler → replace sentinels with "cancelled"
    → emit crawler.stats to runLogger
  (invalid URLs pre-filtered before Crawlee sees them; avoids whole-batch abort)

### createRunLogger(runId, { repo, logger }) → RunLogger
  levelMethod(fields, message):
    → pino log (stdout)
    → repo.append(runId, { level, stage, source, event, message, context })
      ├─ ok → done
      └─ err → log.error("run_log.write_failed")  (swallows, never throws)
  (reserved keys stage/source/event → columns; others → context JSONB)
  (best-effort: a failing insert never aborts the run)

### runCollectorHealthCheck(collector, settings, deps) → CollectorHealthOutcome
  switch collector:
    ├─ "hn" → settings.hn? → Algolia search (keyword or default) → validate hits → {healthy, "algolia hits: N"}
    ├─ "reddit" → settings.reddit.subreddits empty? → {failed,"not configured — add sources…"}
    │            else → fetch r/<sub> RSS (bot UA) → XML-parse → {healthy,"r/<sub>: N entries"}
    ├─ "twitter" → no listIds/users? → {failed,"not configured…"}
    │            → resolveTwitterCollectorCookie() null? → {failed, named cookie secret + /admin/settings}
    │            → rettiwtClientFactory(cookie) → read first list/user (count 1) → {healthy} | classify auth→"rotate cookies"
    ├─ "blog" → settings.web.sources empty? → {failed,"not configured…"} (EDGE-009: no crawl)
    │         → runWebCrawl([firstListingUrl], crawl-only) → requestsFailed===0 & non-empty → {healthy,"crawled <host>"}  (LLM discovery intentionally skipped)
    └─ "web_search" → queries empty? → {failed,"not configured…"}
                    → tavilyApiKey unset? → {failed,"TAVILY_API_KEY is not configured…"} (no factory call)
                    → tavilyFactory(key).search(q, maxItems 1) → {healthy,"tavily results: N"}
  (each wrapped in a per-collector timeout → on timeout {failed, reason includes "timeout"};
   any thrown error → classifyCollectorHealthError(collector, err) → short reason, raw err logged only)

## New services (added: refactor #249 + duplication #250)

- `run-archive-writer.ts` — extracted from `run-process.ts`: `writeFailedArchive(runId, reason, deps)` → writes a failed/cancelled archive row with partial cost; `pickArchiveDigest(ranked)` → picks digest headline/summary from ranked items; `nonEmptyText(s)` → null-coalesces empty strings.
- `finalize-run.ts` — extracted from `run-process.ts`: `finalizeRun(deps, args)` → the success finalize block: digest selection → `serializeArchiveSearchText` → `resolveScheduledPublishAt` → archive upsert → cost persist → Slack `notifySourceDistribution` + conditional `notifyReviewPending` → run.completed log. Per D-051, receives already-resolved deps.

## Gotchas / landmines
- **Run-logger is best-effort**: `repo.append` failure is caught and logged to stdout — it never throws. A DB outage during a run loses telemetry but doesn't crash the pipeline. (D-070)
- **Cost tracker merges per-model**: `ingestExisting` adds to in-memory accumulators; `buildSnapshot` prices them. Merge is idempotent (re-merging the same breakdown doubles token counts — callers must not re-merge). (D-071)
- **Run-state is read-modify-write**: No WATCH/MULTI. The old `concurrency: 1` invariant (single collection worker) is replicated by the in-process `writeSerial` promise-chain in `runCollecting`. (D-072)
- **Credential resolver DB-first**: DB decrypt failure (rotated SESSION_SECRET) returns null — does NOT fall through to env. The operator's intent (admin UI) takes precedence, and a broken DB row signals "use the admin UI to fix this."
- **Blog health check is crawl-only — does NOT validate DeepSeek/LLM** (EDGE-009 / D-110 family): `runCollectorHealthCheck("blog", …)` runs the real crawl/egress path but stops before LLM discovery+extraction. A blog can report `healthy` here and still fail later at the LLM discovery stage of a real run. By deliberate decision — `DEEPSEEK_API_KEY` is intentionally not exercised by the check.
- **"not configured" precedes "missing secret"**: each strategy checks config presence (subreddits/sources/queries non-empty) BEFORE resolving credentials. A `web_search` with no queries reports "not configured — add sources", not "TAVILY_API_KEY missing", even when the key is also unset. Only once a query exists does the missing-secret reason surface. (verified live in functional-verify adversarial pass)

## Decisions
- **D-070**: Best-effort run-logger. Why: telemetry is diagnostic, not operational. A run must complete (and deliver email/social posts) even if the DB is temporarily unavailable for logging. Tradeoff: silent data loss in run_logs during DB outages. Governs: `services/run-logger.ts`.
- **D-071**: Cost tracker merge is additive not idempotent. Why: add-post cost must merge into the existing archive breakdown without double-counting. Callers must pass the existing breakdown once. Tradeoff: no guard against double-merge (caller discipline). Governs: `services/cost-tracker.ts`.
- **D-072**: In-process write serialization for run-state. Why: `Promise.all` over collectors means two near-simultaneous `updateSource` calls can interleave read-modify-write on the shared Redis key. The `writeSerial` promise chain prevents clobbering. Tradeoff: adds ~0 latency (the chain resolves immediately when writes are not simultaneous). Governs: `workers/run-process.ts::runCollecting`.
