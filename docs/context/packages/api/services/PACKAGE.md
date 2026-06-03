---
governs: packages/api/src/services/
last_verified_sha: 5a2ff20
key_files: [review.ts, run-observability.ts, run-source-items.ts, run-list.ts, sources-summary.ts, cancel-run.ts, rank-hydration.ts, runs.ts, scheduler.ts, linkedin-oauth.ts, linkedin-credential-resolver.ts, twitter-handle-resolver.ts, item-preview.ts]
flow_fns: [review.ts::patchArchive, review.ts::promoteItem, review.ts::addPostToArchive, review.ts::regenerateDigestMeta, run-observability.ts::buildRunObservability, run-source-items.ts::buildRunSourceItems, run-list.ts::listRuns, sources-summary.ts::buildSourcesSummary, cancel-run.ts::cancelRun, rank-hydration.ts::hydrateRankedItems, scheduler.ts::reconcilePipelineSchedule]
decisions: [D-002, D-004, D-013, D-014]
status: active
---

# services/ — business logic between routes and repositories

## Purpose

Service functions implement multi-step business operations that span repositories, Redis, and external APIs. Routes call services; services call repositories. Services are stateless pure functions (or async functions with injected deps) — never classes.

## Public surface

- `patchArchive(runId, input, deps) → RunArchiveRow` — validates IDs, computes review diff, atomically updates archive + review_edits
- `promoteItem(runId, input, deps) → RankedItem` — fetches raw item, calls generateRecap, returns hydrated RankedItem
- `addPostToArchive(runId, input, deps) → RankedItem` — detects source type, fetches + hydrates single post
- `regenerateDigestMeta(runId, input, deps) → DigestMeta` — validates input, calls LLM via generateDigestMeta
- `getPool(runId, query, deps) → PoolResponse` — filters raw_items pool (excludes ranked, applies source/shortlist filters)
- `buildRunObservability(runId, deps) → RunObservability` — branches live vs historical, composes funnel/sources/stages/cost/logs
- `buildRunSourceItems(runId, sourceKey, deps) → RunSourceItemsResponse` — parses source key, fetches items, classifies lifecycle
- `listRuns(limit, deps) → RunSummary[]` — scans Redis + DB, merges, sorts by startedAt desc
- `buildSourcesSummary(deps) → SourcesSummaryResponse` — aggregates raw_items telemetry, digest counts, failures
- `cancelRun(runId, deps) → RunState` — validates cancellable state, publishes Redis cancel message
- `hydrateRankedItems(repo, refs, completedAt) → RankedItem[]` — joins ranked refs to raw_items rows, builds enriched output
- `createRun(payload, redis, queue, options) → CreatedRun` — builds synthetic UserSettings, calls shared `startRun()`
- `reconcilePipelineSchedule(queue, settings) → void` — upserts/removes BullMQ job schedulers based on settings
- `resolveLinkedInClient(deps) → LinkedInClientCreds | null` — DB-first credential resolution with env fallback
- `resolveTwitterHandles(handles, deps) → ResolvedHandle[]` — calls rettiwt API to resolve @handle → userId

## Depends on / used by

**Uses:** repositories, `@newsletter/shared` (types, constants, services, scheduling), `@newsletter/pipeline` (add-post, eval), `rettiwt-api` (only in twitter-handle-resolver.ts)
**Used by:** routes

## Data flows

```
patchArchive(runId, input, deps) → RunArchiveRow:
  → archiveRepo.findById(runId) → null → throw NotFoundError
  → rawItemsRepo.findByIds(input.rankedItems[].id) → missing IDs → throw ValidationError
  → build RankedItemRef[] from input (with optional field overrides)
  → build digestMeta from keys present in input ("k" in input check) (D-013)
  → compute effectiveHeadline/effectiveSummary (post-patch values for searchText)
  → if reviewEditsRepo configured AND archive.preReviewSnapshot:
      → diffReview(snapshot, new state) → edit rows
      → runTransaction(tx => editsRepo.replaceForRun + archiveRepo.updateRankedItemsInTx)
  → else: archiveRepo.updateRankedItems(runId, refs, updateCtx)

buildRunObservability(runId, deps) → RunObservability:
  → Promise.all: redis.get, archiveRepo.findById, runLogRepo.listForRun
  → neither runState nor archive → throw NotFoundError
  → live = runState exists AND status not terminal
  → funnel = live ? deriveFunnelFromLogs(logs) : composeHistoricalFunnel(archive, logs)
    deriveFunnelFromLogs: iterate logs for stage.result events → populate collected/deduped/shortlisted/ranked
  → sources = live ? sourcesFromRunState : sourcesFromArchive
  → cost = archive?.costBreakdown ?? null
  → failures = logs.filter(level === "error")
  → return { run, funnel, sources, enrichment, stages, cost, logs, failures, live }

cancelRun(runId, deps) → RunState:
  → redis.get(runKey) → null → check archive for terminal → throw if terminal/not-found
  → parse RunState
    ├─ status = "cancelling" → return state (idempotent)
    ├─ status terminal → throw CancelConflictError
    └─ status = "running"
        → transition to "cancelling" → redis.set → publisher.publish(runCancelChannel) (D-014)
        → return updated state

hydrateRankedItems(repo, refs, archiveCompletedAt) → RankedItem[]:
  → repo.findByIds(refs[].rawItemId) → build Map<id, RawItemRow>
  → for each ref:
      ├─ row not found → skip
      └─ displayTitle = ref.title ?? rawRecap?.title ?? row.title
      → recap = ref.* ?? rawRecap.* fallback
      → isLegacyArchive? → enrichedSource = null : pickSummarySource(row.content, row.metadata.enrichedLink)
      → build RankedItem with derived sourceIdentifier + built itemPreview

reconcilePipelineSchedule(queue, settings) → void:
  → !scheduleEnabled: removeJobScheduler for all channels
  → scheduleEnabled:
      → upsertJobScheduler pipeline-run at pipelineTime (cron) in scheduleTimezone
      → upsertJobScheduler social-health at pipelineTime - 15min
      → for each channel (email, linkedin, twitter):
          ├─ !enabled → removeJobScheduler
          └─ enabled → upsertJobScheduler at channel's time
```

## Gotchas / landmines

- **`patchArchive` uses `"k" in input` to distinguish "not provided" from "set to null".** Zod `.optional()` drops absent keys. Explicit `null` writes null (clears the field); omitting the key preserves the existing DB value. (D-013)
- **`addPostToArchive` has a 30s timeout.** Adjust `ADD_POST_TIMEOUT_MS` if web crawling is consistently slow.
- **`cancelRun` publishes to Redis pub/sub, not BullMQ.** The pipeline worker subscribes to `run:cancel:<runId>` directly for mid-stage abort. (D-014)

## Decisions

- **D-013:** Digest-meta fields use `"k" in input` for presence detection. **Why:** Zod `.optional()` drops absent keys. **Tradeoff:** Explicit undefined is indistinguishable from omission (zod rejects it anyway). **Governs:** `review.ts::patchArchive`.
- **D-014:** Run cancellation uses Redis pub/sub, not BullMQ job control. **Why:** Pipeline collectors run in-process via `Promise.allSettled`; BullMQ job cancellation only works between job invocations. **Tradeoff:** Lost pub/sub message means silent failure — operator retries. **Governs:** `cancel-run.ts`.
