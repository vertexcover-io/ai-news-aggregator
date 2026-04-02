# @newsletter/shared

Drizzle DB schema, shared types, constants, utils, and the DB client.

## Responsibilities
- All Drizzle schema definitions and migrations live here
- Exports DB client (`getDb`, `AppDb`) and Redis connection (`createRedisConnection`)
- Exports shared TypeScript types used across api and pipeline packages
- Exports pino logger factory (`createLogger`)

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
