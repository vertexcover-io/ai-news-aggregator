# E2E Test Strategy Design

## Overview

Layered end-to-end testing strategy for the AI Newsletter monorepo. Tests use real infrastructure (Postgres, Redis) and real external APIs (hnrss.org) to verify the full data flow from job enqueue through collection to database storage.

The strategy starts with the pipeline package (the only package with implemented features) and defines the pattern for API and frontend e2e tests as those packages are built out.

## Test Runner

Vitest workspaces — one workspace config per package defining two projects:
- **unit** — fast, mocked, parallel
- **e2e** — real infra, real APIs, sequential

This avoids introducing a second test runner. When browser tests are needed later (web package), Playwright is layered in separately.

## Directory Structure

```
packages/pipeline/
  tests/
    unit/                              # Migrated from src/__tests__/
      collectors/hn.test.ts
      workers/collection.test.ts
      raw-items-schema.test.ts
      shared-types.test.ts
      fixtures/
        hn-feed.json
        hn-comments.json
    e2e/
      collectors/hn.e2e.test.ts
      workers/collection.e2e.test.ts
      db/schema.e2e.test.ts
      setup/
        global-setup.ts
        teardown.ts
        test-db.ts
        test-redis.ts
  vitest.workspace.ts
```

Future packages follow the same pattern:

```
packages/api/tests/{unit,e2e}/
packages/web/tests/{unit,e2e}/        # Browser e2e uses Playwright, not Vitest workspace
```

## Vitest Workspace Config

`packages/pipeline/vitest.workspace.ts` defines two projects:

### Unit project
- **Include:** `tests/unit/**/*.test.ts`
- **Timeout:** 5s per test
- **Parallel:** yes
- **Global setup:** none

### E2E project
- **Include:** `tests/e2e/**/*.e2e.test.ts`
- **Timeout:** 30s per test
- **Parallel:** no (sequential via `--sequence`)
- **Global setup:** `tests/e2e/setup/global-setup.ts`
- **Global teardown:** `tests/e2e/setup/teardown.ts`

## Package Scripts

```json
{
  "test": "vitest run",
  "test:unit": "vitest run --project unit",
  "test:e2e": "vitest run --project e2e",
  "test:watch": "vitest --project unit"
}
```

Turborepo gets `test:unit` and `test:e2e` tasks for cross-package orchestration.

## Test Database

**Database name:** `newsletter_test`

Runs in the same Postgres instance as dev (`pnpm infra:up`). No extra containers.

### Environment

`.env.test` (gitignored):
```
DATABASE_URL=postgresql://newsletter:newsletter@localhost:5432/newsletter_test
REDIS_URL=redis://localhost:6379
```

`.env.test.example` (committed):
```
DATABASE_URL=postgresql://newsletter:newsletter@localhost:5432/newsletter_test
REDIS_URL=redis://localhost:6379
```

E2e global setup loads `.env.test` before running.

### Lifecycle

1. **Global setup** — Connect to Postgres instance (using the `postgres` maintenance DB), `CREATE DATABASE newsletter_test` if it doesn't exist, run Drizzle migrations against it, verify Redis is reachable
2. **Before each test** — `TRUNCATE` all tables with `CASCADE`, drain BullMQ queues
3. **Global teardown** — Truncate all tables (leave schema intact for next run)

## Test Utilities

### `tests/e2e/setup/global-setup.ts`
- Creates `newsletter_test` database if it doesn't exist
- Runs Drizzle migrations against `newsletter_test`
- Verifies Redis connectivity
- Runs once before the entire e2e suite

### `tests/e2e/setup/teardown.ts`
- Truncates all tables after the full suite completes
- Leaves schema intact for faster subsequent runs

### `tests/e2e/setup/test-db.ts`
- Exports `getTestDb()` — returns a Drizzle client connected to `newsletter_test`
- Exports `truncateAll()` — truncates all tables with CASCADE, used in `beforeEach`

### `tests/e2e/setup/test-redis.ts`
- Exports `getTestRedis()` — returns an IORedis instance
- Exports `cleanQueues()` — drains BullMQ queues, used in `beforeEach`

## E2E Test Cases (Pipeline)

### HN Collector (`tests/e2e/collectors/hn.e2e.test.ts`)

Real hnrss.org calls, real Postgres writes:

1. **Fetches items from HN and stores in raw_items** — Run `collectHn()` with default config, verify rows in `raw_items` with `source_type = 'hn'`, valid titles, URLs, engagement JSONB
2. **Fetches comments for collected items** — Verify `metadata` JSONB contains comment arrays with author and text fields
3. **Deduplicates on repeated collection** — Run `collectHn()` twice, verify no duplicates (unique constraint on `source_type + external_id`), existing rows are updated via upsert
4. **Respects keyword filtering** — Run with narrow keyword set, verify returned items match
5. **Respects points threshold** — Run with high `pointsThreshold`, verify all stored items meet it
6. **Handles rate limiting gracefully** — Verify multiple requests complete without 429 errors

### Job Queue (`tests/e2e/workers/collection.e2e.test.ts`)

Real BullMQ jobs through real Redis:

1. **Job enqueue -> worker processes -> data in DB** — Enqueue `hn-collect` job, wait for completion, verify `raw_items` rows exist
2. **Job completes with correct result shape** — Verify completed job returns `CollectorResult` with `itemsFetched`, `itemsStored`, `durationMs` > 0
3. **Failed job is recorded** — Enqueue job with invalid config, verify failed state with error details

### Database Integration (`tests/e2e/db/schema.e2e.test.ts`)

1. **Sources table CRUD** — Insert a source, read it back, verify all fields
2. **Raw items foreign key to sources** — Insert source, insert raw_item referencing it, verify relationship
3. **Unique constraint enforcement** — Insert same `(source_type, external_id)` twice, verify upsert behavior

## Conventions

| Rule | Detail |
|------|--------|
| File naming | `*.test.ts` for unit, `*.e2e.test.ts` for e2e |
| Timeouts | 5s unit, 30s e2e |
| Test isolation | `truncateAll()` + `cleanQueues()` in `beforeEach` |
| Mocking in e2e | None — real Postgres, real Redis, real external APIs |
| Assertions | Vitest built-in `expect` only |
| Execution | E2e runs sequentially to avoid DB race conditions |

## Future Extension

### API package (`packages/api/tests/e2e/`)
Same Vitest workspace pattern. Tests exercise Hono routes against real Postgres. Same `newsletter_test` DB, same setup/teardown helpers (shared via `@newsletter/shared` or duplicated).

### Web package (`packages/web/tests/e2e/`)
Playwright for browser tests. Separate config (not Vitest workspace). Tests the full stack: browser -> API -> DB. Requires API server running. Uses same `newsletter_test` database.

## Prerequisites

- `pnpm infra:up` must be running (Postgres + Redis)
- `.env.test` must exist with `newsletter_test` database URL
- No additional containers or services needed
