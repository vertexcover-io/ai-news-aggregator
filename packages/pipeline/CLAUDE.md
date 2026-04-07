# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, etc.) and upsert into `raw_items`
- Processors transform/dedup/rank items as pure functions called from workers
- Workers dispatch BullMQ jobs to collectors and processors based on job name
- Services own cross-cutting state (Redis run-state, candidate loading) shared by workers
- Repository modules handle DB access (via `@newsletter/shared` schema)

## Layout
- `src/collectors/` — one file per source (`hn.ts`, `reddit.ts`); each is a `(deps, config) => Promise<CollectorResult>`
- `src/processors/` — pure stage functions (`dedup.ts`, `rank.ts`, `rank-prompt.ts`); ranking uses Vercel AI SDK `generateObject` with a Gemini model
- `src/queues/` — BullMQ `Queue` definitions (`collection.ts`, `processing.ts`); the API enqueues a flow whose parent runs in the processing queue and whose children run in the collection queue
- `src/workers/` — `Worker` instances that consume each queue (`collection.ts` for collector jobs, `run-process.ts` for the parent that dedups and ranks)
- `src/services/` — `run-state.ts` (Redis-backed per-run status read/write) and `candidate-loader.ts` (loads `raw_items` rows for ranking)
- `src/repositories/` — Drizzle wrappers like `createRawItemsRepo(db)`
- `prompts/` — system prompts shipped alongside code (`rank-system.md`)

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector/processor functions — no business logic in workers
- Use `createRawItemsRepo(db)` for DB access, not raw `db.insert()`
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
