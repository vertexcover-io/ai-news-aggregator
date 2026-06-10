# `newsletter/enforce-tenant-scope`

Queries against tenant-owned tables inside repository modules must be
tenant-scoped: the factory should thread a `ctx`/`TenantContext`, queries
should carry a `.where(...)`, and raw `sql` must reference `tenant_id`.

This is a **tripwire**, not a prover. It is intentionally conservative —
it favors false-negatives over false-positives, and is wired as a **warning**
in `eslint.config.mjs` during the multi-tenancy rollout.

## Rationale

In a multi-tenant world every read/write against a tenant-owned table must be
filtered by `tenant_id`, or one tenant can see or clobber another's data. The
repository layer is the single place runtime DB access is allowed
(see [`newsletter/enforce-repository-access`](./enforce-repository-access.md)),
so it is also the single place to enforce scoping. `tenantScope(col, ctx?)`
from `@newsletter/shared/db` produces the `where` predicate and the
insert `stamp`; this rule nudges authors toward using it.

## Scope

Runs only on files whose path contains `/repositories/`. On any other file it
is a no-op.

## Options

```jsonc
{
  "tenantOwnedTables": ["raw_items", "run_archives", "subscribers"],
  "appLevelTables": ["tenants", "users"]
}
```

- **`tenantOwnedTables`** — snake_case table names that carry `tenant_id`.
  Only these are checked. If empty, the rule does nothing.
- **`appLevelTables`** — global tables (e.g. the tenant registry) that are not
  per-tenant; never reported.

Drizzle table identifiers (e.g. `rawItems`) are mapped to table names
best-effort by converting camelCase → snake_case (`raw_items`). If an
identifier cannot be resolved to a configured tenant-owned table, it is
skipped.

## Heuristics

1. **`missingCtxParam`** — a `create*Repo` factory whose body references a
   tenant-owned table identifier but whose params declare no `ctx` /
   `TenantContext`.
2. **`unscopedQuery`** — a `.from(<tenantTable>)` whose surrounding call chain
   contains no `.where(...)`.
3. **`rawSqlMissingTenant`** — a `` sql`...` `` tagged template whose text
   matches `FROM`/`UPDATE`/`INTO <tenantTable>` but does not contain
   `tenant_id`.

## Examples

### Valid

Scoped query — `.where(scope.where())` is present:

```ts
// packages/pipeline/src/repositories/raw-items-repo.ts
import { rawItems, tenantScope } from "@newsletter/shared/db";

export const createRawItemsRepo = (db, ctx) => ({
  list: () => {
    const scope = tenantScope(rawItems.tenantId, ctx);
    return db.select().from(rawItems).where(scope.where());
  },
});
```

Raw SQL that references `tenant_id`:

```ts
sql`select * from raw_items where tenant_id = ${ctx.tenantId}`;
```

### Invalid

Factory touches a tenant-owned table but declares no `ctx`:

```ts
export const createRawItemsRepo = (db) => ({
  all: () => db.select().from(rawItems).where(eq(1, 1)),
  // => missingCtxParam
});
```

`.from(tenantTable)` with no `.where(...)` in the chain:

```ts
db.select().from(runArchives); // => unscopedQuery
```

Raw SQL against a tenant-owned table without `tenant_id`:

```ts
sql`select id from subscribers where active = true`; // => rawSqlMissingTenant
```

## When to disable

During Phase 1 this rule is a warning and may legitimately fire on call sites
not yet migrated. Prefer fixing (thread `ctx`, apply `scope.where(...)`) over
disabling. As the migration completes, severity is raised in
`eslint.config.mjs`.
