---
paths:
  - "packages/shared/src/db/**/*.ts"
---

# Database Rules

## Schema and migrations

- All schema definitions live in `@newsletter/shared` under `src/db/schema.ts` (or split by domain)
- All schema changes go through Drizzle Kit migrations — never write raw ALTER TABLE statements
- Run `pnpm drizzle-kit generate` to create migrations, `pnpm drizzle-kit migrate` to apply them
- Never modify a migration file after it has been applied

## Queries

- Use Drizzle's query builder for standard CRUD operations
- Only drop to raw SQL via `db.execute()` when Drizzle genuinely cannot express the query (complex aggregations, CTEs, window functions)
- Keep query logic in the package that needs it (API services or pipeline processors), not in the shared package — shared only exports the schema and client

> Raw ALTER TABLE via db.execute() is enforced by newsletter/no-raw-alter-table.
