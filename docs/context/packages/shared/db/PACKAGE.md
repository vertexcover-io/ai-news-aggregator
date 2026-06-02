---
governs: packages/shared/src/db/
last_verified_sha: 5a2ff20
key_files: [schema.ts, client.ts, redis.ts]
flow_fns: []
decisions: [D-102, D-103, D-105]
status: active
---

# db/ — Drizzle ORM schema, Postgres client, Redis connection

## Purpose
Defines every database table via Drizzle ORM, the Postgres client singleton, and the Redis connection factory. This is the only package in the monorepo that owns table definitions.

## Public surface
- getDb() → AppDb — singleton Drizzle client (lazy-init, cached)
- createRedisConnection(opts?) → IORedis — creates Redis client with maxRetriesPerRequest: null for BullMQ
- Tables: rawItems, runArchives, runLogs, userSettings, socialCredentials, socialTokens, subscribers, emailSends, sesEvents, evalRuns, reviewEdits, mustReadEntries

## Depends on / used by
Uses: drizzle-orm, postgres, ioredis
Used by: api, pipeline

## Gotchas / landmines
1. getDb() is a module-level singleton — tests must mock DATABASE_URL
2. createRedisConnection sets maxRetriesPerRequest: null — required by BullMQ
3. Generated migrations must be inspected for bare ADD COLUMN ... NOT NULL (D-105)
