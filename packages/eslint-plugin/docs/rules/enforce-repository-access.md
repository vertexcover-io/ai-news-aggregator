# `newsletter/enforce-repository-access`

Two checks share this rule:

1. **Import boundary** — value imports of `@newsletter/shared/db` and
   `drizzle-orm` are only allowed inside repository modules. Type-only
   imports are allowed everywhere.
2. **Tenant-scope guard (REQ-014)** — inside repository modules, every
   query-builder call against a tenant-owned table must carry a tenant
   predicate (or use the explicit `withAllTenants()` escape hatch).

## Rationale

The monorepo architecture routes all runtime database access through thin
per-aggregate repository modules under `packages/*/src/repositories/`.
Services, workers, and route handlers must inject a repository rather than
reach directly into Drizzle or `@newsletter/shared/db`. This keeps SQL and
schema coupling in one well-defined place per package, makes tests easier
to fake, and prevents ad-hoc queries from scattering across the codebase.

The repository pattern guards **runtime** DB access, not the type system —
schema types like `RawItemInsert` and `AppDb` are legitimate cross-cutting
types used by collectors, tests, and fixtures, so `import type { ... }`
is always allowed.

See the project architecture rule:
[`.claude/rules/architecture.md`](../../../../.claude/rules/architecture.md)

## Scope

Configured in the root `eslint.config.mjs` to run on:

- `packages/api/src/**/*.ts`
- `packages/pipeline/src/**/*.ts`

and to ignore:

- `packages/api/src/repositories/**`
- `packages/pipeline/src/repositories/**`
- `**/*.test.ts`, `**/*.test.tsx`, `packages/*/tests/**`

## Examples

### Valid

Type-only import from `@newsletter/shared/db` in a service file — the
repository pattern guards runtime access, not types:

```ts
// packages/pipeline/src/services/candidate-loader.ts
import type { RawItemInsert } from "@newsletter/shared/db";

export const load = (): RawItemInsert[] => [];
```

Type-only import from `drizzle-orm`:

```ts
// packages/api/src/services/run-service.ts
import type { SQL } from "drizzle-orm";

export const buildClause = (): SQL | null => null;
```

Mixed inline type-only specifiers (all specifiers marked `type`):

```ts
// packages/api/src/services/run-service.ts
import { type RawItemInsert, type AppDb } from "@newsletter/shared/db";

export const fn = (_db: AppDb, _item: RawItemInsert): void => undefined;
```

Value import from `drizzle-orm` inside a repository module (allowed by
scope — repositories are the one place allowed to hold query logic):

```ts
// packages/pipeline/src/repositories/raw-items-repo.ts
import { eq, and } from "drizzle-orm";
```

Value import from `@newsletter/shared/db` in a test file (tests are
excluded by scope):

```ts
// packages/api/tests/e2e/runs.test.ts
import { rawItems } from "@newsletter/shared/db";
```

Unrelated subpath — only `@newsletter/shared/db` and `drizzle-orm` are
restricted:

```ts
// packages/pipeline/src/services/candidate-loader.ts
import { createLogger } from "@newsletter/shared/logger";
```

### Invalid

Value import of `eq` from `drizzle-orm` in a service file:

```ts
// packages/pipeline/src/services/candidate-loader.ts
import { eq } from "drizzle-orm";
// => repositoryOnly: move this query into packages/pipeline/src/repositories/
```

Value import of `getDb` from `@newsletter/shared/db` in a worker file:

```ts
// packages/pipeline/src/workers/run-process.ts
import { getDb } from "@newsletter/shared/db";
// => repositoryOnly
```

Value import of a Drizzle table from `@newsletter/shared/db`:

```ts
// packages/pipeline/src/services/ranker.ts
import { rawItems } from "@newsletter/shared/db";
// => repositoryOnly
```

Subpath import from `drizzle-orm/sql` — any `drizzle-orm/*` subpath counts:

```ts
// packages/pipeline/src/services/candidate-loader.ts
import { sql } from "drizzle-orm/sql";
// => repositoryOnly
```

Mixed value + type specifiers still fires if at least one specifier is a
value import:

```ts
// packages/api/src/services/run-service.ts
import { eq, type SQL } from "drizzle-orm";
// => repositoryOnly
```

## Type-only carve-out

The rule explicitly allows:

1. `import type { ... } from "@newsletter/shared/db"` — declaration-level
   `type` keyword.
2. `import type Default from "drizzle-orm"` — type-only default import.
3. `import { type Foo, type Bar } from "..."` — inline `type` on every
   specifier. If **any** specifier is a value (no `type`), the whole
   statement is flagged.
4. Any import whose source is not `@newsletter/shared/db`,
   `@newsletter/shared/db/*`, `drizzle-orm`, or `drizzle-orm/*` — this rule
   only targets the two restricted sources.

## Tenant-scope guard (`tenantScopeRequired`)

Multi-tenancy isolates the 13 tenant-owned tables (`raw_items`,
`run_archives`, `run_logs`, `review_edits`, `email_sends`, `subscribers`,
`feedback_events`, `ses_events`, `eval_runs`, `must_read_entries`,
`user_settings`, `social_credentials`, `social_tokens`) by a `tenant_id`
column. Repositories must route every read/write predicate through the
`tenantScoped(...)` helper (and stamp inserts via `scopedTenantId(...)`),
both exported from `@newsletter/shared/db`.

### How it checks

The rule looks at `*.from(table)`, `*.insert(table)`, `*.update(table)`,
and `*.delete(table)` calls in `repositories/**` files where `table` is one
of the tenant-owned schema identifiers above. The **enclosing function**
must lexically contain one of the recognized markers:

- `tenantScoped(` — the canonical predicate seam
- `scopedTenantId(` — insert stamping
- `withAllTenants(` — the audited super-admin cross-tenant escape hatch
  (throws for any non-`super_admin` role; only `requireSuperAdmin` paths
  may construct it)
- `systemScope(` — the audited server-side cross-tenant escape hatch for
  trusted flows with no user session (e.g. the SNS webhook, which only
  reaches repository code after AWS SNS signature verification); only
  server bootstrap wiring may construct it
- a bare `tenantId` reference — covers hand-rolled
  `eq(table.tenantId, ...)` predicates

Heuristic, by design: function-level granularity tolerates predicates
assembled across several statements while staying auditable. Raw
``db.execute(sql`...`)`` queries are **not** covered — those must embed the
tenant predicate manually (grep for `tenantSql` in
`packages/api/src/repositories/run-archives.ts` for the pattern).

### Allowlist

`users` and `tenants` are platform-level tables (login-by-email lookup,
tenant CRUD) and are deliberately absent from the tenant-owned list — no
tenant predicate is required for them.

### Valid

```ts
// packages/api/src/repositories/must-read.ts
import { eq } from "drizzle-orm";
import { mustReadEntries, tenantScoped } from "@newsletter/shared/db";

export function findById(db: Db, ctx: TenantScope | undefined, id: string) {
  return db
    .select()
    .from(mustReadEntries)
    .where(tenantScoped(mustReadEntries.tenantId, ctx, eq(mustReadEntries.id, id)))
    .limit(1);
}
```

### Invalid

```ts
// packages/api/src/repositories/must-read.ts
import { eq } from "drizzle-orm";
import { mustReadEntries } from "@newsletter/shared/db";

export function findById(db: Db, id: string) {
  return db
    .select()
    .from(mustReadEntries)
    .where(eq(mustReadEntries.id, id)) // => tenantScopeRequired
    .limit(1);
}
```

## When to disable

Do not disable per line. If you genuinely need runtime DB access, add a
new function to the relevant repository under
`packages/<pkg>/src/repositories/` and inject it into the service that
needs the data. The rule exists specifically to prevent inline disables
from spreading DB coupling across the codebase.
