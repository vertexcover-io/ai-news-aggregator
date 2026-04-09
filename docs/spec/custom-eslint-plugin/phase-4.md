# Phase 4: Refactor pre-existing DB violations into repositories

> **Status:** pending

## Overview

Before turning on `newsletter/enforce-repository-access` in Phase 5, clean the baseline: every current runtime import of `@newsletter/shared/db` or `drizzle-orm` outside `**/repositories/**` must be refactored into a repository module, OR the imported symbol must be moved out of the DB subpath (for Redis helpers that are not DB-related).

This phase touches code in both `api` and `pipeline` packages. No new behavior is introduced — only structural relocation. All existing tests must still pass at the end.

## Known violations (from planning exploration)

| File | Imports | Action |
|---|---|---|
| `packages/api/src/services/rank-hydration.ts` | `inArray` from `drizzle-orm` | Create `packages/api/src/repositories/raw-items.ts` exposing a method like `findByIdsInSet(ids)`. Refactor the service to call the repo. |
| `packages/pipeline/src/services/candidate-loader.ts` | `and`, `gte`, `inArray` from `drizzle-orm`; `rawItems` from `@newsletter/shared/db` | Create `packages/pipeline/src/repositories/candidates.ts` exposing a method that returns ranked candidate rows given the current query shape. Refactor the service. |
| `packages/pipeline/src/workers/collection.ts` | `getDb`, `createRedisConnection` from `@newsletter/shared/db` | Replace `getDb` usage with repository injection (if any runtime access remains). Replace `createRedisConnection` with the new `@newsletter/shared/redis` subpath. |
| `packages/pipeline/src/workers/run-process.ts` | any runtime DB imports (audit during implementation) | Inject repositories instead of calling `getDb()` directly. |
| `packages/pipeline/src/queues/processing.ts` | `createRedisConnection` from `@newsletter/shared/db` | Update import to `@newsletter/shared/redis`. |
| `packages/pipeline/src/queues/collection.ts` | `createRedisConnection` from `@newsletter/shared/db` | Update import to `@newsletter/shared/redis`. |

**Note:** the implementer must re-run a grep for runtime value imports of `@newsletter/shared/db` and `drizzle-orm` under `packages/{api,pipeline}/src/` (excluding `**/repositories/**` and `**/tests/**`) before starting. The list above was captured during planning and may be incomplete.

## Implementation

**Files to create:**
- `packages/shared/src/redis.ts` — re-export `createRedisConnection` from here (or move the implementation entirely — check what's easiest)
- `packages/api/src/repositories/raw-items.ts` — repository for the `rank-hydration` use case
- `packages/pipeline/src/repositories/candidates.ts` — repository for the `candidate-loader` use case
- Any additional repositories the implementer discovers during the audit

**Files to modify:**
- `packages/shared/package.json` — add `./redis` to the `exports` map
- `packages/shared/src/index.ts` (or `src/db/index.ts`) — stop re-exporting `createRedisConnection` from the `db` subpath
- `packages/api/src/services/rank-hydration.ts` — consume the new API repo
- `packages/pipeline/src/services/candidate-loader.ts` — consume the new pipeline repo
- `packages/pipeline/src/workers/collection.ts`, `run-process.ts` — remove direct `getDb()` and `drizzle-orm` value imports; accept a repo via dependency injection
- `packages/pipeline/src/queues/processing.ts`, `collection.ts` — import from `@newsletter/shared/redis`

### Pattern to follow

- `packages/pipeline/src/repositories/raw-items.ts` is the canonical pattern:
  - Exported `interface FooRepo { ... }` defining the contract
  - Exported `createFooRepo(db: Pick<AppDb, "select" | "insert" | ...>)` returning a plain object
  - No business logic — just the DB query shape
  - `AppDb` / schema types imported as `import type { ... }` (still allowed under the type-only carve-out)

### Dependency injection

The services/workers that currently call `getDb()` and then build queries inline must be rewritten to receive a repo as a constructor/factory argument. Look at how `createHnCollector(deps)` wires `rawItemsRepo` today — use the same pattern.

### Tests

- Existing unit tests for `rank-hydration`, `candidate-loader`, workers, and queues must still pass after the refactor
- If a service's test was mocking `db.select()` directly, it must now mock the repository instead (simpler mock shape)
- No new tests are required in this phase unless the implementer adds them for the new repositories (recommended but not mandatory — the type system catches most shape mismatches)
- E2E tests under `tests/e2e/**` exercise the real DB and will naturally cover the repo boundary

**Traces to:** (no direct REQ, but this phase unblocks REQ-050 by removing pre-existing violations so the clean baseline holds when the rule is enabled in Phase 5)

**Commit:** `refactor(VER): route all runtime DB access through repository modules`

## Done When

- [ ] `grep -rn "from 'drizzle-orm'" packages/api/src packages/pipeline/src --exclude-dir=repositories --exclude-dir=tests` shows only `import type` lines
- [ ] Same check for `from '@newsletter/shared/db'`
- [ ] `createRedisConnection` is imported from `@newsletter/shared/redis` everywhere; no runtime imports of `@newsletter/shared/db` remain in queue/worker files
- [ ] `pnpm typecheck` still passes (5/5)
- [ ] `pnpm lint` still passes (4+/5 — plugin package now also linted)
- [ ] `pnpm test:unit` still passes (≥178 tests)
- [ ] Manual spot-check: diff is structural (extract + inject), no behavior changes
