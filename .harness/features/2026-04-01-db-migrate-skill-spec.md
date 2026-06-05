# Skill Spec: /db-migrate

> Run Drizzle Kit database migrations safely with pre-flight checks and post-migration verification. Prevents broken migrations from silently corrupting the database.

---

## What problem does this solve?

Database migrations are one of the riskiest operations in any project. A bad migration can:

- Drop data you didn't intend to lose
- Create schema inconsistencies between code and database
- Break the API and pipeline if columns/tables don't match what the code expects
- Be hard to roll back once applied

Without this skill, running migrations means remembering the right Drizzle Kit commands, hoping you're in the right directory, and manually checking that everything looks right after. This skill adds safety rails.

---

## When should this skill trigger?

- User says "run migrations", "migrate the database", "apply schema changes", "db migrate"
- User just modified `packages/shared/src/db/schema.ts` and needs to generate + apply a migration
- User says "check migration status", "what migrations are pending"
- User wants to create a new migration without applying it yet

---

## What should it do?

### 1. Pre-Flight Checks

Before doing anything, verify the environment is ready:

- **Is PostgreSQL running?** Check if the database is reachable (via `pg_isready` or a simple query through PostgreSQL MCP). If not, suggest `pnpm infra:up`.
- **Is the connection string correct?** Read `DATABASE_URL` from `.env` and confirm it points to the right database.
- **Are there uncommitted schema changes?** Check `git status` for changes in `packages/shared/src/db/`. Warn if the schema file has been modified but not committed — migrations should be generated from committed code to stay in sync.
- **Are there pending migrations?** Check if previously generated migration files haven't been applied yet. Show them.

Report the results before proceeding:

```
Pre-flight checks:
  PostgreSQL reachable    — yes (localhost:5432)
  Database exists         — yes (newsletter)
  Schema file modified    — yes (uncommitted changes in schema.ts)
  Pending migrations      — 1 (0001_add_candidates_table.sql)
```

### 2. Generate Migration

When the user has modified the schema and needs a new migration:

- Run `pnpm drizzle-kit generate` from the shared package directory
- Show the generated SQL file so the user can review it before applying
- Highlight destructive operations: `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN` that could lose data
- If the generated migration contains destructive operations, warn explicitly and ask for confirmation

Example output:
```
Generated migration: 0002_add_review_status.sql

SQL:
  ALTER TABLE "candidates" ADD COLUMN "review_status" varchar(20) DEFAULT 'pending';
  CREATE INDEX "candidates_review_status_idx" ON "candidates" ("review_status");

No destructive operations detected. Safe to apply.
```

### 3. Apply Migration

Run the migration against the database:

- Run `pnpm drizzle-kit migrate` from the shared package directory
- Capture the output (success/failure)
- If it fails, show the error and the failing SQL statement
- If it succeeds, confirm which migrations were applied

### 4. Post-Migration Verification

After applying, verify everything is consistent:

- **Schema match** — Query the actual database schema (via PostgreSQL MCP or `\d` commands) and compare against what Drizzle expects. Flag any mismatches.
- **Build check** — Run `pnpm build` in the shared package to ensure TypeScript types still compile against the new schema.
- **Type check** — Run `pnpm typecheck` across all packages to catch any code that references removed/renamed columns.

Report results:
```
Post-migration verification:
  Schema matches Drizzle  — yes
  Shared package builds   — yes
  Typecheck (all packages) — yes (0 errors)

Migration applied successfully.
```

### 5. Migration Status

Show the current state without changing anything:

- List all migration files in order
- Show which have been applied and which are pending
- Show the current database schema version
- Compare the schema file against the actual database to detect drift

```
Migration status:
  Applied:
    0001_initial_schema.sql         — applied 2026-04-01 10:00
    0002_add_candidates_table.sql   — applied 2026-04-01 14:30
  Pending:
    0003_add_review_status.sql      — not yet applied
  
  Schema drift: none detected
```

### 6. Rollback Guidance

Drizzle Kit doesn't have built-in rollback. If a migration went wrong, the skill should:

- Show what the migration changed (from the SQL file)
- Generate the reverse SQL statements needed to undo it
- Present them for the user to review before executing
- Warn that manual rollback is risky and should only be done if the migration was just applied
- Never auto-execute rollback SQL — always require explicit user confirmation

---

## Input

- `/db-migrate` — run pre-flight checks, then ask what to do (generate, apply, status)
- `/db-migrate status` — show migration status only
- `/db-migrate generate` — generate a new migration from schema changes
- `/db-migrate apply` — apply pending migrations with pre/post verification
- `/db-migrate generate --apply` — generate and immediately apply (still runs all checks)

---

## Prerequisites

- PostgreSQL must be running (`pnpm infra:up`)
- Must be run from the project root or `packages/shared/`
- The `.env` file must have a valid `DATABASE_URL`

---

## How it works under the hood

- Uses `drizzle-kit generate` and `drizzle-kit migrate` CLI commands via Bash
- Uses PostgreSQL MCP (or `psql` via Bash as fallback) to query actual database schema
- Reads migration files from the Drizzle migrations directory
- Reads `packages/shared/src/db/schema.ts` to understand expected schema
- Runs `pnpm build` and `pnpm typecheck` for post-migration verification

---

## Safety rules

- **Never auto-apply destructive migrations.** Always show the SQL and ask for confirmation when `DROP` or destructive `ALTER` is present.
- **Never modify migration files that have already been applied.** If the user asks to change an applied migration, explain why that's dangerous and suggest creating a new migration instead.
- **Never run migrations against production without explicit confirmation.** Check `DATABASE_URL` — if it doesn't point to localhost, warn loudly.
- **Always run post-migration verification.** Don't report success without confirming schema match and build pass.
