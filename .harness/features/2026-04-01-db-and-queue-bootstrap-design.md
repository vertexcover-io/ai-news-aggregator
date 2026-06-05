# DB ORM Layer + BullMQ Queue Bootstrap — Design

> Minimal bootstrap for Drizzle ORM (schema, migrations, client) and BullMQ (Redis connection, one queue, one worker) to prove both pipelines work end-to-end. No feature logic — just plumbing.

---

## Scope

This covers two items from VER-30:
- **Setup DB ORM Layer + Migrations** — Drizzle schema, client, config, and first migration
- **Setup Background Job Processing Queue** — Redis connection, BullMQ queue + worker proof-of-concept

Explicitly out of scope:
- Full data model (items, digests, pipeline_runs) — comes when those features are built
- Actual collector/processor logic
- Typed job payloads beyond a simple `{ source: string }`
- Multiple queues or pipeline stage chaining

---

## Part 1: DB ORM Layer + Migrations

### Files

All in `packages/shared/`:

#### `src/db/schema.ts`

A single `sources` table:

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `serial` | Primary key |
| `name` | `text` | Not null, unique |
| `type` | `text` | Not null — one of: `hn`, `reddit`, `twitter`, `rss`, `github`, `blog`, `newsletter` |
| `url` | `text` | Not null |
| `enabled` | `boolean` | Not null, default `true` |
| `created_at` | `timestamp` | Not null, default `now()` |
| `updated_at` | `timestamp` | Not null, default `now()` |

The `type` column uses a Drizzle `pgEnum` for the 7 source types from the MVP sources doc.

#### `src/db/client.ts`

- Reads `DATABASE_URL` from `process.env`
- Creates a `postgres` (postgres.js) SQL connection
- Wraps it with Drizzle's `drizzle()` function
- Exports `getDb()` that returns the Drizzle client instance

#### `drizzle.config.ts`

- Lives at `packages/shared/drizzle.config.ts`
- Points schema to `src/db/schema.ts`
- Outputs migrations to `src/db/migrations/`
- Reads `DATABASE_URL` from environment

#### `src/db/index.ts`

Re-exports from `schema.ts` and `client.ts` so consumers import from `@newsletter/shared/db`.

### Scripts

Added to `packages/shared/package.json`:
- `db:generate` — `drizzle-kit generate`
- `db:migrate` — `drizzle-kit migrate`

### Verification

After implementation, running `pnpm --filter @newsletter/shared db:generate` should produce a migration SQL file in `src/db/migrations/`, and `pnpm --filter @newsletter/shared db:migrate` should apply it to the local PostgreSQL (via `pnpm infra:up`).

---

## Part 2: BullMQ Queue Infrastructure

### Redis Connection — `packages/shared/src/db/redis.ts`

- Reads `REDIS_URL` from `process.env`
- Exports `createRedisConnection()` that returns an `IORedis` instance
- Both `@newsletter/api` and `@newsletter/pipeline` import this

This lives alongside the DB client in `shared` because it's the same concern: infrastructure connection config shared across packages.

### Queue Definition — `packages/pipeline/src/queues/collection.ts`

- Creates a BullMQ `Queue` named `"collection"`
- Uses `createRedisConnection()` from `@newsletter/shared/db`
- Exports the queue instance

### Worker — `packages/pipeline/src/workers/collection.ts`

- Creates a BullMQ `Worker` on the `"collection"` queue
- Handler logs `"Processing collection job: <job.id>"` and completes
- No actual collection logic — proves the worker infrastructure works

### Entry Point — `packages/pipeline/src/index.ts`

- Imports and starts the collection worker
- Registers `SIGTERM`/`SIGINT` handlers for graceful shutdown (`worker.close()`)
- Logs worker lifecycle events (started, job completed, failed, shutdown)

### Job Data

For now, job data is untyped beyond `{ source: string }`. Typed payloads will be added when actual collectors are built.

### Verification

After implementation:
1. Start infra (`pnpm infra:up`)
2. Start pipeline (`pnpm --filter @newsletter/pipeline dev`)
3. Manually enqueue a job via a script or Redis CLI
4. Observe the worker logs picking up and completing the job

---

## Package Dependency Changes

- `@newsletter/shared` gains `ioredis` as a dependency (for the Redis connection factory)
- `@newsletter/pipeline` already depends on `bullmq` and `ioredis` — no changes needed
- `@newsletter/api` already depends on `@newsletter/shared` — no changes needed (it will use the Redis factory when it needs to enqueue jobs later)

---

## What This Enables

After this work, VER-30 is fully complete:
- A developer can define new Drizzle tables, run `db:generate` + `db:migrate`, and they just work
- A developer can define new BullMQ queues and workers, and the Redis connection + worker lifecycle is already handled
- Both build and typecheck pass across all packages
