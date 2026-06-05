---
governs: packages/shared/src/db/
last_verified_sha: ad0153a
key_files: [schema.ts, client.ts, redis.ts]
flow_fns: []
decisions: [D-102, D-103, D-105, D-113]
status: active
---

# db/ — Drizzle ORM schema, Postgres client, Redis connection

## Purpose
Defines every database table via Drizzle ORM, the Postgres client singleton, and the Redis connection factory. This is the only package in the monorepo that owns table definitions.

## Public surface
- getDb() → AppDb — singleton Drizzle client (lazy-init, cached)
- createRedisConnection(opts?) → IORedis — creates Redis client with maxRetriesPerRequest: null for BullMQ
- Tables: rawItems, runArchives, runLogs, userSettings, socialCredentials, socialTokens, subscribers, emailSends, sesEvents, evalRuns, reviewEdits, mustReadEntries
- runArchives.preReviewSnapshot jsonb (`$type<PreReviewSnapshot | null>()`, migration 0035) — captured pre-edit state for the review-edits diff; reviewEdits is the append-only event log (id bigserial, run_id uuid FK → run_archives ON DELETE CASCADE, edit_type, raw_item_id, field, before/after jsonb, position_before/after, created_at), indexed on (run_id) and (edit_type)

## Depends on / used by
Uses: drizzle-orm, postgres, ioredis
Used by: api, pipeline

## Gotchas / landmines
1. getDb() is a module-level singleton — tests must mock DATABASE_URL
2. createRedisConnection sets maxRetriesPerRequest: null — required by BullMQ
3. Generated migrations must be inspected for bare ADD COLUMN ... NOT NULL (D-105)
4. **Migration journal `when` timestamps MUST be monotonically increasing (D-113).** drizzle-kit only applies an entry whose `when` is greater than the last-applied migration's recorded timestamp. 0035 originally shipped with a backdated `when` (1748433600000, out of order with its neighbours), so every DB already past 0034 SKIPPED it silently — no review_edits table, no run_archives.pre_review_snapshot, runtime 42703 errors. Fresh DBs were fine (apply in order from zero) so CI never caught it. Fix: 0035's `when` was corrected AND rewritten to fully idempotent SQL (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, constraint guarded by pg_constraint check); 0037_reapply_record_review_edits re-applies the same idempotent SQL to heal skipped DBs (no-op where 0035 ran). `tests/unit/migrations-journal.test.ts` enforces journal monotonicity going forward.

## Decisions
### D-113 — Migration journal timestamps must be monotonic; heal skipped migrations idempotently
**Why:** drizzle-kit gates application on `when > last-applied when`. A backdated `when` causes already-migrated DBs to silently skip the file, diverging schema without error on fresh DBs (which apply from zero). 0035's backdated entry broke production silently.
**Tradeoff:** Hand-correcting a journal timestamp + shipping a redundant idempotent re-apply migration (0037) is more work than a normal additive migration, but it's the only safe heal for DBs that already advanced past the skipped entry.
**Governs:** packages/shared/src/db/migrations/meta/_journal.json, 0035_record_review_edits.sql, 0037_reapply_record_review_edits.sql
