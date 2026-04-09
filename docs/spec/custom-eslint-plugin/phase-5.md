# Phase 5: `newsletter/enforce-repository-access`

> **Status:** pending

## Overview

Now that the baseline is clean (Phase 4), enable the rule that enforces the repository pattern for all future code. Value imports of `@newsletter/shared/db` or `drizzle-orm` are forbidden outside `**/repositories/**` and `**/tests/**`. Type-only imports are allowed everywhere.

This refines SPEC REQ-050 based on the planning decision and the user's clarification.

## Implementation

**Files to create:**
- `packages/eslint-plugin/src/rules/enforce-repository-access.ts`
- `packages/eslint-plugin/tests/rules/enforce-repository-access.test.ts`
- `packages/eslint-plugin/docs/rules/enforce-repository-access.md`

**Files to modify:**
- `packages/eslint-plugin/src/index.ts` — register the rule
- `eslint.config.mjs` (root) — wire the rule at `"warn"` scoped to `packages/api/src/**` and `packages/pipeline/src/**`, excluding `**/repositories/**` and `**/tests/**`
- `packages/eslint-plugin/docs/rules/README.md` — add to index
- `docs/plans/custom-eslint-plugin/SPEC.md` — add a note under REQ-050 documenting the type-only carve-out (the SPEC clarification agreed during planning)

### Rule logic

**Selector:** `ImportDeclaration` on every file matched by the flat-config scope.

**Logic:**
```ts
ImportDeclaration(node) {
  const source = node.source.value;
  // Only care about the two restricted sources
  const isRestrictedSource =
    source === "@newsletter/shared/db" ||
    source.startsWith("@newsletter/shared/db/") ||
    source === "drizzle-orm" ||
    source.startsWith("drizzle-orm/");
  if (!isRestrictedSource) return;

  // Allow `import type { ... } from "..."`
  if (node.importKind === "type") return;

  // Allow mixed imports where ALL specifiers are type-only
  // (e.g. `import { type Foo, type Bar } from "..."`)
  const allSpecifiersAreTypeOnly =
    node.specifiers.length > 0 &&
    node.specifiers.every(
      (s) =>
        s.type === "ImportSpecifier" &&
        (s as TSESTree.ImportSpecifier).importKind === "type",
    );
  if (allSpecifiersAreTypeOnly) return;

  // Otherwise this is a value import — report
  const filename = context.filename;
  // (Scope is already enforced via flat-config `files` glob, but bail out
  // defensively if the rule somehow runs on a repository or test file.)
  if (
    filename.includes("/repositories/") ||
    filename.includes("/tests/") ||
    /\.test\.tsx?$/.test(filename)
  ) {
    return;
  }

  context.report({
    node,
    messageId: "repositoryOnly",
    data: {
      source,
      expected: filename.includes("/packages/api/")
        ? "packages/api/src/repositories/"
        : "packages/pipeline/src/repositories/",
    },
  });
},
```

**Messages:**
- `repositoryOnly`: "Value imports from `{{source}}` are only allowed inside repository modules. Move this query into `{{expected}}` and inject the repo instead. (Type-only `import type { ... }` is still allowed.)"

**Scope in root `eslint.config.mjs`:**
```js
{
  files: [
    "packages/api/src/**/*.ts",
    "packages/pipeline/src/**/*.ts",
  ],
  ignores: [
    "packages/api/src/repositories/**",
    "packages/pipeline/src/repositories/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "packages/*/tests/**",
  ],
  plugins: { newsletter },
  rules: { "newsletter/enforce-repository-access": "warn" },
},
```

### SPEC clarification

Append to `docs/plans/custom-eslint-plugin/SPEC.md` under REQ-050 a clarification block:

> **Clarification (2026-04-09):** Type-only imports (`import type { ... }`) from `@newsletter/shared/db` and `drizzle-orm` are allowed in all files. Only value imports are flagged. Rationale: the repository pattern guards *runtime* DB access, not the type system. Schema types (e.g. `RawItemInsert`, `AppDb`) are legitimate cross-cutting types used by collectors, tests, and fixtures.

## What to test (RuleTester)

**Valid:**
- `import type { RawItemInsert } from "@newsletter/shared/db"` — in a service file (type-only)
- `import type { SQL } from "drizzle-orm"` — in a worker file
- `import { type Foo, type Bar } from "@newsletter/shared/db"` — mixed type-only syntax
- `import { eq, and } from "drizzle-orm"` — in a file whose path matches `**/repositories/**` (scope ignores it)
- `import { rawItems } from "@newsletter/shared/db"` — in a test file
- `import { createLogger } from "@newsletter/shared/logger"` — different subpath, not restricted

**Invalid:**
- `import { eq } from "drizzle-orm"` — in a service file → `repositoryOnly`
- `import { getDb } from "@newsletter/shared/db"` — in a worker file → `repositoryOnly`
- `import { rawItems } from "@newsletter/shared/db"` — in a worker file → `repositoryOnly`
- `import { sql } from "drizzle-orm/sql"` — subpath import → `repositoryOnly`

**Error message assertion:**
- Test that the message for a file path containing `/packages/api/` includes the substring `packages/api/src/repositories/`
- Test that the message for a file path containing `/packages/pipeline/` includes the substring `packages/pipeline/src/repositories/`

**Traces to:** REQ-050, REQ-051, REQ-052, REQ-053, EDGE-003, EDGE-006

**Commit:** `feat(VER): add newsletter/enforce-repository-access rule`

## Done When

- [ ] Rule + tests + docs page exist
- [ ] `pnpm --filter @newsletter/eslint-plugin test:unit` passes the new suite
- [ ] Meta walker confirms the rule has docs URL + docs file + messages
- [ ] `pnpm lint` at root runs clean — zero new warnings thanks to Phase 4's cleanup
- [ ] SPEC.md clarification note is added under REQ-050
- [ ] `pnpm typecheck`, `pnpm test:unit` still pass monorepo-wide
