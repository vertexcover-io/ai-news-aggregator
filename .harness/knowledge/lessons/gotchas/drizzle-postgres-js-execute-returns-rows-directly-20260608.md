---
title: "drizzle-orm/postgres-js db.execute returns rows directly, not result.rows"
date: 2026-06-08
category: gotchas
tags: [drizzle-orm, postgres-js, database, sql, adapter]
component: shared/db
severity: medium
status: implemented
applies_to: ["packages/*/src/repositories/**/*.ts", "packages/shared/src/db/**/*.ts"]
stage: [code]
evidence_count: 1
last_validated: 2026-06-08
source: hard-won-success@centralized-observability
related: []
---

# drizzle-orm/postgres-js `db.execute` returns rows directly, not `result.rows`

## Problem

When writing a raw SQL upsert using `db.execute(sql\`...\`)` in `packages/pipeline/src/repositories/incidents.ts`, accessing `result.rows[0]` returned `undefined`. The upsert succeeded (rows were written) but the returned value was read incorrectly.

## Insight

**Different Drizzle adapters return different shapes from `db.execute`.**

| Adapter | `db.execute(sql)` return |
|---------|--------------------------|
| `drizzle-orm/postgres-js` | The rows array directly — `result[0]` is the first row |
| `drizzle-orm/neon-http` | `{ rows: Row[], fields: FieldDef[] }` — `result.rows[0]` |
| `drizzle-orm/node-postgres` (pg) | `{ rows: Row[], rowCount: number, ... }` — `result.rows[0]` |

This repo uses `postgres-js`. The `db.execute` call returns the raw postgres-js result, which is an array of rows.

## Solution

```ts
// file: packages/pipeline/src/repositories/incidents.ts (or any repo using db.execute)

// WRONG (neon/node-postgres pattern):
const result = await db.execute(sql`SELECT * FROM incidents WHERE id = ${id}`);
const row = result.rows[0]; // undefined with postgres-js

// CORRECT (postgres-js pattern):
const rows = await db.execute(sql`SELECT * FROM incidents WHERE id = ${id}`);
const row = rows[0]; // works
```

For typed access, cast the result:

```ts
const rows = await db.execute(sql`...`) as unknown as IncidentRow[];
if (rows.length === 0) return null;
return rows[0];
```

## Prevention / Reuse

- **When writing `db.execute` in this repo, treat the return value as an array directly.** `result.rows` does not exist — it will silently be `undefined` without a type error (because `db.execute` returns `any` in many Drizzle versions).
- **Copy the pattern from an existing repo** (`packages/api/src/repositories/incidents.ts` or `packages/pipeline/src/repositories/incidents.ts`) rather than porting from a neon/pg example.
- **Signal:** `rows[0]` is always `undefined` even though the SQL ran successfully and rows were inserted — wrong adapter return-shape is the cause.
