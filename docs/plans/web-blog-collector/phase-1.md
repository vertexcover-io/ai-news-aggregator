# Phase 1: Foundations (types, repo addition, new deps)

> **Status:** pending
> **Traces to:** REQ-001 (types only), REQ-002, REQ-003, REQ-030, REQ-070, REQ-071, REQ-082

## Overview

After this phase, the collector has all the public types it needs, the repo
exposes `findExistingExternalIds`, and the four new dependencies (`ai`,
`@ai-sdk/google`, `zod`, `p-limit`) are installed at pinned exact versions.
No `collectWeb` function yet — just the scaffolding everything else builds on.

## Implementation

**Files:**
- Modify: `packages/pipeline/package.json` — add `ai`, `@ai-sdk/google`, `zod`, `p-limit` to `dependencies` at exact versions
- Modify: `packages/pipeline/src/types.ts` — add `BlogSource`, `WebCollectConfig`, `WebCollectJobData`, `CollectorFailure`, `WebCollectorResult`
- Modify: `packages/pipeline/src/repositories/raw-items.ts` — extend `RawItemsRepo` interface and `createRawItemsRepo` factory with `findExistingExternalIds`
- Create: `packages/pipeline/tests/unit/repositories/raw-items.test.ts` — unit test for `findExistingExternalIds` with a mocked Drizzle query builder. (If there's no existing repo unit test file, this is the first one and establishes the pattern.)

**Pattern to follow:** `packages/pipeline/src/types.ts` for the config interface style, `packages/pipeline/src/repositories/raw-items.ts:9-22` for repo extension style.

**What to test:**
- `findExistingExternalIds('blog', [])` returns an empty `Set` without hitting the DB
- `findExistingExternalIds('blog', ['a', 'b', 'c'])` issues exactly one SELECT with `WHERE source_type = 'blog' AND external_id = ANY($2)` and returns a `Set` containing only the IDs the DB returned
- Returned type is `Set<string>`, membership checks are O(1)
- Integration-style coverage (full DB round-trip) is deferred to Phase 7's e2e test 3 (dedup act)

**Traces to:** REQ-030

**What to build:**

### Dependency versions (look up before installing)

Use `pnpm view <pkg> version` and context7 `/vercel/ai` to confirm current stable versions:

```bash
pnpm view ai version
pnpm view @ai-sdk/google version
pnpm view zod version
pnpm view p-limit version
```

Pin the exact version (no `^`, no `~`) into `packages/pipeline/package.json` per `.claude/rules/tooling.md`. Install with `pnpm install --filter @newsletter/pipeline`.

### `packages/pipeline/src/types.ts` additions

```ts
export interface BlogSource {
  name: string;
  listingUrl: string;
}

export interface WebCollectConfig {
  sources: BlogSource[];
  maxItems: number;
  sinceDays?: number;
  postConcurrency?: number;
}

export interface WebCollectJobData {
  config: WebCollectConfig;
}

export interface CollectorFailure {
  source: string;
  postUrl?: string;
  error: string;
}

// Extends the shared CollectorResult with an optional failures field.
// `CollectorResult` stays unchanged in @newsletter/shared.
import type { CollectorResult } from "@newsletter/shared/types";

export interface WebCollectorResult extends CollectorResult {
  failures?: CollectorFailure[];
}
```

Guardrails per REQ-070/071/082:
- `CollectorFailure` has **exactly** three fields — no `stage`, no others
- `WebCollectorResult extends CollectorResult` — TS structural subtype
- `@newsletter/shared` is not modified

### `packages/pipeline/src/repositories/raw-items.ts` extension

Add to the `RawItemsRepo` interface:

```ts
findExistingExternalIds(
  sourceType: SourceType,
  externalIds: string[],
): Promise<Set<string>>;
```

(Import `SourceType` from `@newsletter/shared/db`.)

Implement in `createRawItemsRepo`. Short-circuit the empty input case to avoid issuing a pointless query:

```ts
async findExistingExternalIds(sourceType, externalIds) {
  if (externalIds.length === 0) return new Set();

  const rows = await db
    .select({ externalId: rawItems.externalId })
    .from(rawItems)
    .where(
      and(
        eq(rawItems.sourceType, sourceType),
        inArray(rawItems.externalId, externalIds),
      ),
    );

  return new Set(rows.map((r) => r.externalId));
}
```

Imports: `and`, `eq`, `inArray` from `drizzle-orm`. The existing file uses `sql` from `drizzle-orm` so drizzle is already a devDependency — reuse it.

Also widen the `db` parameter type in `createRawItemsRepo` to include `select`:

```ts
export function createRawItemsRepo(db: Pick<AppDb, "insert" | "select">): RawItemsRepo {
```

### Unit test for `findExistingExternalIds`

Create `packages/pipeline/tests/unit/repositories/raw-items.test.ts`. Since the repo takes a `Pick<AppDb, ...>`, we can mock just the parts we need using vitest mocks. For the query builder chain, either (a) mock the whole chain with `vi.fn().mockReturnThis()` stubs or (b) use an in-memory Drizzle with `pglite` — but pglite is not a project dep, so stick with (a).

Test cases:
1. Empty input → returns empty `Set`, `db.select` is **never called**
2. 3 IDs where DB returns 2 → `Set.size === 2`, contains exactly those 2
3. 3 IDs where DB returns 0 → empty `Set`
4. `sourceType` filter is applied — mock captures the where clause and asserts it contains both `sourceType` and `inArray` predicates

Keep the test narrow — no integration coverage here, that lives in Phase 7.

**Commit:** `feat(VER-47): add web collector types and findExistingExternalIds`

## Done When

- [ ] `pnpm --filter @newsletter/pipeline build` clean
- [ ] `pnpm typecheck` clean (no `any`, no `@ts-ignore`)
- [ ] `pnpm lint` clean
- [ ] `pnpm test:unit` — all existing tests still pass, new repo test passes
- [ ] `packages/pipeline/package.json` has `ai`, `@ai-sdk/google`, `zod`, `p-limit` at exact versions
- [ ] `CollectorResult` in `@newsletter/shared/types/index.ts` is **unchanged** (verify via `git diff`)
- [ ] `CollectorFailure` has exactly `source`, `postUrl?`, `error` — no other fields
