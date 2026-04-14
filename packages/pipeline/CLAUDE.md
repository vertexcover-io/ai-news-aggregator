# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, etc.) and upsert into `raw_items`
- Processors transform/dedup/rank items as pure functions called from workers
- The `run-process` worker is the single BullMQ job per run — it runs all requested collectors concurrently in-process, then dedups and ranks
- Services own cross-cutting state (Redis run-state, candidate loading) shared by workers
- Repository modules handle DB access (via `@newsletter/shared` schema)

## Layout
- `src/collectors/` — one file per source (`hn.ts`, `reddit.ts`, `web.ts`); each exports both the batch collector (`collectHn`, `collectReddit`, `collectWeb`) called by the run-process worker AND the single-post fetcher (`fetchHnPost`, `fetchRedditPost`, `fetchWebPost`) used by the add-post flow. `web.ts` also exports `extractFallbackImage` for OG/twitter/favicon image extraction.
- `src/processors/` — pure stage functions (`dedup.ts`, `shortlist.ts`, `rank.ts`); `shortlist.ts` is the stage-1 Voyage-embedding cosine shortlist with recency decay, and `rank.ts` is the stage-2 Claude Haiku reranker using Vercel AI SDK `generateObject`, with prompts inlined as TS consts in `rank-prompts.ts`; `recap.ts` is a standalone `generateRecap()` helper used by the add-post flow to generate recap content for a single added item.
- `src/queues/` — BullMQ `Queue` definitions (`processing.ts` is the only queue the API enqueues to; `collection.ts` is kept in place for rollback and no longer receives new jobs)
- `src/workers/` — a single dispatching `Worker` in `processing.ts` that routes jobs by `job.name` to processor functions; `run-process.ts` exports `handleRunProcessJob()` (collects via `Promise.allSettled`, dedups, ranks); `daily-run.ts` exports `handleDailyRunJob()` (loads saved settings and calls `startRun()`). `collection.ts` is legacy and left in place for rollback.
- `src/services/` — `run-state.ts` (Redis-backed per-run status read/write), `candidate-loader.ts` (loads `raw_items` rows for ranking), `embeddings.ts` (Voyage AI client for stage-1), `recency.ts` (half-life decay helper), `markdown-fetch.ts` (shared Jina-backed `fetchMarkdown({ signal?: AbortSignal })`), and `add-post-helper.ts` (`hydrateAddedPost()` orchestrates single-item fetch + recap; `dispatchFetch()` forwards both `signal` and `fetchFn` to the appropriate single-post collector)
- `src/repositories/` — Drizzle wrappers like `createRawItemsRepo(db)`

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector/processor functions — no business logic in workers
- Use repository factories (e.g. `createRawItemsRepo(db)`) for DB access — value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside `src/repositories/**` (enforced by `newsletter/enforce-repository-access`)
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports
- `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` are both validated at worker startup (not per job) — stage-2 rerank always needs Anthropic, stage-1 shortlist always needs Voyage. `RANKING_MODEL` defaults to `claude-haiku-4-5-20251001`.

## Path Aliases
- `@pipeline/*` → `src/*` (configured in tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
