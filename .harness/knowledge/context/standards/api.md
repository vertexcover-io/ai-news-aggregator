---
id: S-api
applies_to: ["packages/api/src/**"]
enforced_by: eslint
decisions: [D-004]
last_verified_sha: ad0153a
status: active
---

# API standards

## S-api-01 — Repository pattern

**Rule:** Only repository files may import `drizzle-orm` or `@newsletter/shared/db`. Routes and services must go through repository interfaces.

**Enforced by:** eslint `newsletter/enforce-repository-access` (severity: `error`, fails CI)

**Smell:** `import { eq } from "drizzle-orm"` in a route handler or service file.

## S-api-02 — No static pipeline imports

**Rule:** The api package must not statically import `@newsletter/pipeline`. Dynamic `import()` is allowed at route boundaries for add-post, recap, and digest-meta generation.

**Enforced by:** eslint `no-restricted-imports` (severity: `error`, fails CI)

**Smell:** `import { generateRecap } from "@newsletter/pipeline/add-post"` at the top of any api file.

## S-api-03 — Thin route handlers

**Rule:** Route handlers validate input with zod, call a service or repo, and return JSON. Business logic lives in services. Every route file exports a factory function with injectable dependencies.

**Enforced by:** convention (not linted)

**Smell:** A route handler with >20 lines of business logic or a direct DB query.

## S-api-04 — Narrow repository interfaces

**Rule:** Repository factories accept `Pick<AppDb, ...>` slices — the narrowest interface needed, never the full `AppDb`.

**Enforced by:** convention (not linted)

**Smell:** `createSomeRepo(db: AppDb)` — the parameter should be `Pick<AppDb, "table1" | "table2">`.
