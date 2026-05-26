# @newsletter/shared

Drizzle DB schema, shared types, constants, utils, and the DB client.

## Responsibilities
- All Drizzle schema definitions and migrations live here
- Exports DB client (`getDb`, `AppDb`) and Redis connection (`createRedisConnection`)
- Exports shared TypeScript types used across api and pipeline packages
- Exports pino logger factory (`createLogger`)
- Exports `MODEL_PRICING` + `computeCallCost`/`extractAnthropicUsage` (in `pricing.ts` / `cost.ts`) and the `RunCostBreakdown` / `CostStage` / `StageCost` / `ModelStageCost` types (in `types/cost-breakdown.ts`). The `run_archives.cost_breakdown` JSONB column is owned here; new pricing entries must include the five fields `inputPerMTok`, `outputPerMTok`, `cacheReadPerMTok`, `cacheWrite5mPerMTok`, `cacheWrite1hPerMTok` (no separate reasoning rate — thinking tokens bill at the output rate).
- Owns the run-observability surfaces (migration `0031`): the append-only **`run_logs`** table (`runLogs` in `schema.ts` — `id bigserial PK`, `run_id uuid` with a `(run_id, id)` index, `created_at`, `level`/`stage`/`event`/`message text`, `source text NULL`, `context jsonb NULL`) and the nullable **`run_archives.run_funnel jsonb`** column (`.$type<RunFunnel | null>()`). Exports `RunLogLevel` / `RunLogEvent` / `RunLogEntry` / `RunLogInsert` (= `Omit<RunLogEntry, "id" | "ts" | "runId">`) / `RunFunnel` / `RunObservabilityStage` / `RunObservabilitySource` / and the `RunObservability` payload type from `types/observability.ts` (re-exported via `@newsletter/shared/types`).
- Owns the nullable `run_archives.published_at timestamptz` column (added in **migration 0032**) — the *scheduled* publish moment for a reviewed archive. The pure resolver `resolveScheduledPublishAt(input)` lives in `src/scheduling/published-at.ts` (re-exported from `@newsletter/shared/scheduling`) and returns the scheduled publish `Date` or `null` (missing settings, `emailTime === pipelineTime`, or malformed `HH:MM`); it never throws. The pipeline calls it on the success finalize path; API surfaces derive `runDate`/`issueDate` from `coalesce(published_at, completed_at)`. The **late-review immediate-publish helper** `selectImmediatePublishChannels(input: ImmediatePublishInput): PublishChannel[]` lives in `src/scheduling/immediate-publish.ts` (re-exported from `@newsletter/shared/scheduling`): given `{ settings, completedAt, now }`, it returns the enabled channels whose per-channel `publishDateForWindow` moment is strictly in the past (`now > scheduledMoment`). Pure, never throws — bad/missing times and `channelTime === pipelineTime` cause that channel to be omitted. `scheduleEnabled=false` short-circuits to `[]`.

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
