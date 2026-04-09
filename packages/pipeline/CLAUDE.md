# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, etc.) and upsert into `raw_items`
- Processors transform/dedup/rank items as pure functions called from workers
- The `run-process` worker is the single BullMQ job per run — it runs all requested collectors concurrently in-process, then dedups and ranks
- Services own cross-cutting state (Redis run-state, candidate loading) shared by workers
- Repository modules handle DB access (via `@newsletter/shared` schema)

## Layout
- `src/collectors/` — one file per source (`hn.ts`, `reddit.ts`, `web.ts`); each is a `(deps, config) => Promise<CollectorResult>`, called directly by the run-process worker
- `src/processors/` — pure stage functions (`dedup.ts`, `rank.ts`); ranking uses Vercel AI SDK `generateObject` with a Gemini model and inlines its system prompt as a TS const in `rank.ts`
- `src/queues/` — BullMQ `Queue` definitions (`processing.ts` is the only queue the API enqueues to; `collection.ts` is kept in place for rollback and no longer receives new jobs)
- `src/workers/` — `Worker` instances (`run-process.ts` is the single job per run that collects via `Promise.all` with in-process state-write serialization, dedups, and ranks; `collection.ts` is legacy and left in place for rollback)
- `src/services/` — `run-state.ts` (Redis-backed per-run status read/write) and `candidate-loader.ts` (loads `raw_items` rows for ranking)
- `src/repositories/` — Drizzle wrappers like `createRawItemsRepo(db)`

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector/processor functions — no business logic in workers
- Use repository factories (e.g. `createRawItemsRepo(db)`) for DB access — value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside `src/repositories/**` (enforced by `newsletter/enforce-repository-access`)
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports
- `GEMINI_API_KEY` is validated at worker startup (not per job) — ranking always needs it. `RANKING_MODEL` defaults to `gemini-2.5-flash`.

## Path Aliases
- `@pipeline/*` → `src/*` (configured in tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
