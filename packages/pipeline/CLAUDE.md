# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, etc.)
- Workers dispatch jobs to collectors based on job name
- Repository modules handle DB access (via @newsletter/shared schema)

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector functions — no business logic in workers
- Use `upsertItems(db, items)` from `@pipeline/repositories/raw-items` for DB access, not raw `db.insert()`
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports

## Path Aliases
- `@pipeline/*` → `src/*` (configured in tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
