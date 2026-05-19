# @newsletter/shared

Drizzle DB schema, shared types, constants, utils, and the DB client.

## Responsibilities
- All Drizzle schema definitions and migrations live here
- Exports DB client (`getDb`, `AppDb`) and Redis connection (`createRedisConnection`)
- Exports shared TypeScript types used across api and pipeline packages
- Exports pino logger factory (`createLogger`)
- Exports `MODEL_PRICING` + `computeCallCost`/`extractAnthropicUsage` (in `pricing.ts` / `cost.ts`) and the `RunCostBreakdown` / `CostStage` / `StageCost` / `ModelStageCost` types (in `types/cost-breakdown.ts`). The `run_archives.cost_breakdown` JSONB column is owned here; new pricing entries must include the five fields `inputPerMTok`, `outputPerMTok`, `cacheReadPerMTok`, `cacheWrite5mPerMTok`, `cacheWrite1hPerMTok` (no separate reasoning rate — thinking tokens bill at the output rate).

## Rules
- This package defines tables — no other package should
- Export only types that are used by 2+ packages
- Use `.$type<T>()` on jsonb columns for type safety
- Schema changes require `pnpm drizzle-kit generate` to create migrations
- Never modify a migration file after it has been applied

## Commands
pnpm drizzle-kit generate   # Generate migration from schema changes
pnpm drizzle-kit migrate    # Apply pending migrations
pnpm build                  # Build with tsup
pnpm typecheck              # Type check
