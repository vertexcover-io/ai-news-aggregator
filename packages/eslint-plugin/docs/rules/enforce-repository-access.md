# `newsletter/enforce-repository-access`

Value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed
inside repository modules. Type-only imports are allowed everywhere.

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

## Phase 4: Tenant scoping (REQ-014)

In repository files, every query against a **tenant-owned table** must
include a `tenantId` filter. The rule tracks imports of tenant-owned table
symbols and flags any file that uses one without also referencing its
`.tenantId` property.

**Tenant-owned tables:** `rawItems`, `runArchives`, `runLogs`,
`socialCredentials`, `socialTokens`, `userSettings`, `mustReadEntries`,
`subscribers`, `emailSends`, `feedbackEvents`, `sesEvents`, `evalRuns`,
`reviewEdits`.

**Exempt:** `users` (login-by-email is cross-tenant), `tenants` (the
tenant definition table itself).

### Valid (scoped)

```ts
// packages/api/src/repositories/run-archives.ts
import { eq, and } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";

export function findById(db: any, tenantId: string) {
  return db.select().from(runArchives)
    .where(and(eq(runArchives.id, id), eq(runArchives.tenantId, tenantId)));
}
```

### Valid (allowlisted — users table)

```ts
// packages/api/src/repositories/users.ts
import { eq } from "drizzle-orm";
import { users } from "@newsletter/shared/db";

export function findByEmail(db: any, email: string) {
  return db.select().from(users).where(eq(users.email, email));
}
```

### Valid (escape hatch — withAllTenants)

```ts
// packages/api/src/repositories/run-archives.ts
import { eq } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";
import { withAllTenants } from "@newsletter/shared/types/tenant-context";

export function superAdminList(db: any, ctx: TenantContext) {
  const allCtx = withAllTenants(ctx);
  return db.select().from(runArchives).where(eq(runArchives.id, id));
}
```

### Invalid (unscoped)

```ts
// packages/api/src/repositories/run-archives.ts
import { eq } from "drizzle-orm";
import { runArchives } from "@newsletter/shared/db";

export function badQuery(db: any) {
  return db.select().from(runArchives).where(eq(runArchives.id, "x"));
  // => unscopedTenantQuery: must include tenantId filter
}
```

## When to disable

Do not disable per line. If you genuinely need runtime DB access, add a
new function to the relevant repository under
`packages/<pkg>/src/repositories/` and inject it into the service that
needs the data. The rule exists specifically to prevent inline disables
from spreading DB coupling across the codebase.
