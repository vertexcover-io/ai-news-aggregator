# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, etc.) and upsert into `raw_items`
- Processors transform/dedup/rank items as pure functions called from workers
- The `run-process` worker is the single BullMQ job per run — it runs all requested collectors concurrently in-process, then dedups and ranks
- Services own cross-cutting state (Redis run-state, candidate loading) shared by workers
- Repository modules handle DB access (via `@newsletter/shared` schema)

## Layout
- `src/collectors/` — one file per source (`hn.ts`, `reddit.ts`, `web.ts`); each exports both the batch collector (`collectHn`, `collectReddit`, `collectWeb`) called by the run-process worker AND the single-post fetcher (`fetchHnPost`, `fetchRedditPost`, `fetchWebPost`) used by the add-post flow. `web.ts` also exports LLM extraction helpers (`discoverPostUrls`, `extractPostFields`, `validateDiscoveredUrls`, `sortPostsByPublishedAtDesc`, `applySinceDays`, `parseDateOrNull`) and `buildRawItem`. The `twitter/` subdirectory uses `rettiwt-api` via the `RettiwtClient` adapter (`clients/rettiwt.ts`); `denormalize()` unwraps retweets first (`inner = t.retweetedTweet ?? t`) and then extracts any `inner.quoted` into `NormalizedTweet.quotedTweet` so the mapper (`map.ts`) can append a `Quoting @handle: …` block to `RawItem.content` and persist the structured quoted-tweet under `metadata.quotedTweet` — surfacing quoted-tweet text to ranker/recap LLMs. Link enrichment continues to read URLs from the outer (or retweet-unwrapped) tweet only; quoted URLs are stored but not fetched.
- `src/processors/` — pure stage functions (`dedup.ts`, `shortlist.ts`, `rank.ts`); `shortlist.ts` is the stage-1 recency-decay shortlist, and `rank.ts` is the stage-2 Claude Haiku reranker using Vercel AI SDK `generateObject` with a 3-axis prompt (Novelty, Signal-vs-hype, Actionability), with prompts inlined as TS consts in `rank-prompts.ts`; `recap.ts` is a standalone `generateRecap()` helper used by the add-post flow to generate recap content for a single added item.
- `src/queues/` — BullMQ `Queue` definitions (`processing.ts` is the only queue the API enqueues to; `collection.ts` is kept in place for rollback and no longer receives new jobs)
- `src/workers/` — a single dispatching `Worker` in `processing.ts` that routes jobs by `job.name` to processor functions; `run-process.ts` exports `handleRunProcessJob()` (collects via `Promise.allSettled`, dedups, ranks); `daily-run.ts` exports `handleDailyRunJob()` (loads saved settings and calls `startRun()`). `collection.ts` is legacy and left in place for rollback.
- `src/index.ts` — process entrypoint; creates a shared Redis connection used by both the processing worker and the `RunStateService`. The `processingWorker.on("failed")` handler calls `runState.setStage(runId, "failed", "failed")` for `run-process` jobs so stalled or otherwise externally-failed jobs propagate their state to Redis (and the UI stops polling as `"running"` forever). The `processingWorker.on("stalled")` handler logs a warning — BullMQ will retry automatically; state is only updated when stall exceeds `maxStalledCount` and BullMQ fires `failed`. Exports `getRunIdFromJobData` for extracting `runId` from raw BullMQ job data.
- `src/services/` — `run-state.ts` (Redis-backed per-run status read/write), `candidate-loader.ts` (loads `raw_items` rows for ranking), `recency.ts` (half-life decay helper), `web-crawler.ts` (Crawlee `AdaptivePlaywrightCrawler` wrapper — `runWebCrawl(jobs, opts)`), `web-fetch/` (`types.ts`, `index.ts`, `convert.ts`, `fetch-adaptive.ts`, `fetch-static.ts`, `fetch-browser.ts` — Crawlee+Readability+Turndown HTML→markdown pipeline), `link-enrichment/` (`types.ts`, `url-classifier.ts`, `cache.ts`, `fetcher.ts`, `index.ts` — `enrichRawItems(items, ctx)` enriches Reddit/HN/Twitter items' external URLs in place via `fetchAdaptive`; classifier skips self-posts, same-platform links, non-HTML media, and cache hits; one shared `EnrichmentContext` per run carries the URL cache, counters, run-level AbortSignal, and logger), and `add-post-helper.ts` (`hydrateAddedPost()` orchestrates single-item fetch + recap; `dispatchFetch()` forwards both `signal` and `fetchFn` to the appropriate single-post collector)
- `src/repositories/` — Drizzle wrappers like `createRawItemsRepo(db)`; the run-archives repo exposes `setCostBreakdown(runId, breakdown)` which UPDATEs `run_archives.cost_breakdown` (callers must guarantee the archive row exists first — failure paths in `workers/run-process.ts` insert a partial archive row before persisting cost).
- `src/services/cost-tracker.ts` — `createCostTracker(runId)` returns `{ record, snapshot, merge }`. Wired into the four LLM call sites (`collectors/web.ts::discoverPostUrls` and `extractPostFields`, `processors/rank.ts::rerank`, `processors/recap.ts::generateRecap`) via an optional `reportUsage`/tracker parameter, so the run-process worker finalises and persists `tracker.snapshot()` to `run_archives.cost_breakdown` on success / failure / cancellation, and `add-post-helper.ts` uses `tracker.merge(existing).snapshot()` to add-post-merge into an existing breakdown.
- `src/social/` — auto-post integrations that fire from the `newsletter-send` worker after subscriber email + Slack send-summary. `linkedin/` and `twitter/` each contain `oauth.ts` (token refresh), `api-client.ts` (low-level platform HTTP — LinkedIn's `createComment` calls `socialActions/{postUrn}/comments`; Twitter's `createPost` accepts `replyToTweetId` for threaded replies), and `notifier.ts` (the `notifyArchiveReady({ runId })` entrypoint that composes message text, posts the head post, then posts the archive URL as a comment (LinkedIn) or reply tweet (Twitter), marks the run with `linkedin_posted_at` / `twitter_posted_at` + `social_metadata`, and returns a `posted | skipped | already_posted | failed` result; a comment/reply failure logs a warning but never demotes a successful head post to a failure). `compose.ts` builds the platform-agnostic message body — note that the archive URL is **never** embedded in either the LinkedIn body or the Twitter body; it is always posted separately as a comment/reply by the notifier. `test-post.ts` powers the admin "Send test post" button by reusing the same notifier with a synthetic payload. `cli-helpers.ts` is the shared OAuth-bootstrap CLI used by `scripts/social-*.ts`.

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector/processor functions — no business logic in workers
- Use repository factories (e.g. `createRawItemsRepo(db)`) for DB access — value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside `src/repositories/**` (enforced by `newsletter/enforce-repository-access`)
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports
- `ANTHROPIC_API_KEY` is validated at worker startup (not per job) — stage-2 rerank always needs Anthropic. `RANKING_MODEL` defaults to `claude-haiku-4-5-20251001`.

## Path Aliases
- `@pipeline/*` → `src/*` (configured in tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
