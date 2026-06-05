---
governs: packages/pipeline/src/eval/
last_verified_sha: 5a2ff20
key_files: [index.ts, replay.ts, scoring.ts, mode-b.ts, manual-fixture.ts, export-fixtures.ts, fixture-io.ts, cache.ts, run-eval-cli.ts, score-history.ts, cost-estimator.ts]
flow_fns: [index.ts::runEval, mode-b.ts::runModeB, replay.ts::fixtureToCandidates, scoring.ts::ndcgAtK, export-fixtures.ts::exportFixtures]
decisions: [D-130, D-131]
status: active
---

# eval/ — offline ranking evaluation pipeline

## Purpose
Replays ranking prompts against saved fixtures and ground-truth labels to measure ranking quality (nDCG, precision, recall). Supports two modes: Mode A (scored, pre-built fixtures with ground truth) and Mode B (calendar, builds fixtures from a day's raw_items, compares saved vs. draft prompts side-by-side). Exports fixtures from historical archives for labeling.

## Public surface
- `runEval(args, deps?)` → `RunEvalOutput` — ranks a fixture, scores against ground truth, caches result
- `runModeB(args, deps?)` → `ModeBResult` — calendar mode: ranks same pool with saved + draft prompts, returns both rankings
- `buildCalendarFixture(date, pool, model)` → `Fixture` — builds in-memory fixture from raw items
- `fixtureToCandidates(fixture)` → `Candidate[]` — converts fixture items to ranker input (excludes dedup losers)
- `createManualFixture(urls, options?, deps?)` → `CreateManualFixtureResult` — creates fixture from URLs (fetch + enrich)
- `exportFixtures(options)` → `ExportResult` — exports fixtures from completed archives in date range
- `listFixtures(dir?)` → `Fixture[]`, `readFixture(path)` → `Fixture`, `writeFixture(fixture, dir?)` → `string`
- `readGroundTruth(fixtureId)` → `GroundTruth | null`, `writeGroundTruth(truth)` → `void`
- `ndcgAtK(ranked, labels, k)` → `number` — Normalized Discounted Cumulative Gain
- `precisionAtK(ranked, labels, k)` → `number` — precision in top-k
- `mustIncludeRecall(ranked, labels, k)` → `number` — fraction of ground-truth "must" items recovered
- `rankOneIsMustInclude(ranked, labels)` → `boolean` — top-ranked item is labeled "must"
- `perItemDiff(ranked, labels)` → `PerItemDiffRow[]` — union diff of ranker output vs. ground truth
- `sourcingReport(graded)` → `SourcingReportRow[]` — aggregate must/nice/drop per source type
- `EvalCache` class — filesystem cache keyed by (fixtureId, prompt, model) for avoiding re-rank costs
- `readScoreHistory(fixtureId?)` → `ScoreHistoryEntry[]`, `recordScore(score)` → `void`

## Depends on / used by
- Uses: `@pipeline/processors/rank`, `@pipeline/processors/dedup`, `@pipeline/services/cost-tracker`, `@pipeline/services/link-enrichment`, `@pipeline/services/candidate-loader`, `@pipeline/repositories/eval-exports`, `@pipeline/repositories/raw-items`, `@newsletter/shared`
- Used by: `@newsletter/api` (via `eval-entry.ts` barrel — admin eval UI routes), CLI (`scripts/eval-ranking.ts`)

## Data flows

### runEval(args, deps?) → RunEvalOutput
  fixture, groundTruth, prompt, model, cache, abortSignal
    → cache.get(fixtureId, prompt, model)
      ├─ cache hit → computeScore from cached rankedItems → return { cost: { cacheHit: true } }
      └─ cache miss → fixtureToCandidates(fixture)
          → rankCandidates(candidates, { systemPrompt: prompt, modelId: model, topN: EVAL_K, tracker })
            → tracker.snapshot() → extract cost
              → cache.set(fixtureId, prompt, model, { rankedItems, usage })
                → computeScore(rankedItems, groundTruth) → RunEvalOutput
  (cache is EvalCache — filesystem-based; avoids re-ranking the same prompt+fixture)

### runModeB(args, deps?) → ModeBResult
  fixture, savedPrompt, draftPrompt, model, cache
    → runEval with savedPrompt → saved ranking + cost
    → runEval with draftPrompt → draft ranking + cost
    → ModeBResult { saved, draft, cost: { saved, draft, totalUsd } }
  (both runs share the same fixture; mode-b.ts::runModeB is a thin orchestrator)

### fixtureToCandidates(fixture) → Candidate[]
  fixture → build excludedIds set from dedupClusters
    → fixture.pool.filter(id not excluded) → map to Candidate
      → pickCandidateContent (enrichedLink.markdown > content > null) → Candidate[]
  (uses same pickCandidateContent as production candidate loader)

## Gotchas / landmines
- **Calendar mode pool attribution by run_id**: `loadDedupedPool` in `eval-exports.ts` loads `raw_items WHERE run_id = archive.id` (exact attribution). Falls back to `collectedAt` time window only for pre-migration archives with no `run_id`-stamped items. (D-130)
- **Pool is deduped at eval time**: Calendar mode loads raw items then runs `dedupCandidates` — the eval sees the same deduped pool the ranker would have seen, not the raw un-deduped set. `itemCount` is the deduped pool size on both the list row and detail view. (D-131)
- **Cache key includes prompt text**: `EvalCache` keys by `(fixtureId, hashPrompt(prompt), model)`. Changing the prompt text (even whitespace) invalidates the cache.
- **Mode A uses pre-built fixtures**: Fixtures are JSON files with pool items, dedup clusters, and optional original ranker output. Mode B builds fixtures on-the-fly from DB.

## Decisions
- **D-130**: Calendar mode uses `run_id` for pool attribution. Why: two runs on the same calendar day must be isolated — `collectedAt` window would mix their items. The `run_id` column is stamped during collection and updated on re-collect (the pointer moves forward). Tradeoff: pre-migration archives need the `collectedAt` fallback, which may include items from a same-day second run. Governs: `repositories/eval-exports.ts::loadDedupedPool`.
- **D-131**: Dedup at eval-read time, not at fixture-export time. Why: the ranker always sees deduped candidates; the eval must replicate the same input. Tradeoff: dedup runs on every detail-view load (acceptable — dedup is O(n) and pool sizes are <200). Governs: `repositories/eval-exports.ts`, `processors/dedup.ts`.
