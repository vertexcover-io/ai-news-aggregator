---
title: "Tenant-scoped repos must STAMP tenant_id on INSERT, not just filter SELECT"
date: 2026-06-12
category: design-patterns
tags: [multi-tenant, tenant-id, repository, drizzle, insert, not-null, type-safety]
component: api/pipeline repositories
severity: high
status: implemented
applies_to: ["packages/api/src/repositories/**", "packages/pipeline/src/repositories/**", "packages/shared/src/db/**"]
stage: [code, review]
evidence_count: 3
last_validated: 2026-06-12
source: hard-won-success@multi-tenant
related: [".harness/knowledge/lessons/gotchas/stale-db-false-green-per-purpose-postgres-20260612.md"]
---

# Tenant-scoped repos must STAMP tenant_id on INSERT, not just filter SELECT

## Problem

When converting a single-tenant app to multi-tenant, the obvious half of "scope every query" is the read side — add `WHERE tenant_id = $scope` to SELECTs. The write side is the half that silently rots: once a migration enforces `tenant_id NOT NULL` (with no DB DEFAULT), every tenant-owned INSERT/upsert that doesn't supply `tenant_id` fails at runtime with Postgres `23502 not-null violation` — **while `tsc` stays green**, because the Drizzle column type is still declared nullable. Typecheck passes, tests against a DEFAULT-bridged DB pass, and the gap only surfaces as a 500 on a real write.

## Insight

**A tenant fence has two halves — `tenantScoped()` on reads and `scopedTenantId(ctx)` stamped on every write — and the write half is invisible to the type checker until `tenant_id` is part of the primary key.** Model the write contract explicitly so the compiler enforces it:

- Repo factories take `ctx?: TenantScope`. Reads stay scope-optional (`tenantScoped(ctx)` no-ops without a scope, for system/bootstrap paths). Writes call `scopedTenantId(ctx)` and stamp it on the insert object.
- The moment `tenant_id` joins the **primary key** (`notNull` in the Drizzle schema), `$inferInsert` requires a `string`, so `scopedTenantId(ctx): string | undefined` stops compiling — that compile error is the signal to switch from "stamp if scoped" to `requireTenantId(ctx)` that **throws on an unscoped write**. Default-deny, enforced by the type system.
- A subsystem with no per-request tenant yet (the pipeline, pre per-job-tenant threading) needs an explicit bridge: resolve the default/AGENTLOOP tenant once at bootstrap (`primeDefaultTenantScope(db)` — async, cached, re-primed lazily by per-job factories), rather than leaving writes unscoped.

## Solution

```ts
// repo factory — reads scope-optional, writes stamp-required
function createSourcesRepo(db: AppDb, ctx?: TenantScope) {
  return {
    list: () => db.select().from(sources).where(tenantScoped(ctx, sources.tenantId)),
    insert: (row: NewSource) =>
      db.insert(sources).values({ ...row, tenantId: requireTenantId(ctx) }), // throws if unscoped
  };
}

// pipeline bridge until per-job tenant ids exist
const defaultTenantScope = await primeDefaultTenantScope(db); // resolves AGENTLOOP once, cached
```

To tighten `tenant_id` to NOT NULL mid-branch *before* all writers pass it (D-105): keep the Drizzle column nullable so `$inferInsert` doesn't break compilation, hand-append a guarded `SET NOT NULL` to the generated migration, and have the backfill script set a column `DEFAULT = tenant-0 uuid` on every tenant-owned table so pre-tenancy INSERTs still succeed during the transition. Remove the DEFAULT only once every writer stamps explicitly.

Test gotcha: unit fakes that key rows by some column and sniff `eq()` predicates must walk Drizzle `queryChunks` **recursively** — `tenantScoped()` wraps `eq(platform)` inside `and(eq(tenant_id), …)`, so a shallow predicate sniff misses it.

## Prevention / Reuse

- After adding `tenant_id NOT NULL`, grep every `repositories/**` for `.insert(` / `.values(` / `onConflict` and confirm each stamps `requireTenantId(ctx)` — a green `tsc` does NOT prove this while the column type is nullable.
- Make the unscoped-write path a thrown error, not a silent `undefined` — fail closed.
- Give every tenant-less subsystem (workers, cron, bootstrap) an explicit named bridge scope; never let a write fall through to "no tenant."
- Recurrence signal: runtime `23502 null value in column "tenant_id"` on a path that typechecks clean.

## Related

- `.harness/knowledge/lessons/gotchas/stale-db-false-green-per-purpose-postgres-20260612.md` — why the DEFAULT bridge + backfill ordering also bites fresh-DB stacks
- `.harness/knowledge/lessons/architecture/fail-open-authorization-by-omission-20260612.md` — the same "optional dep = silent gap" failure mode on the authorization side
