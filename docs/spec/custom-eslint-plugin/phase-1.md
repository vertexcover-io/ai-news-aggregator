# Phase 1: Scaffold `@newsletter/eslint-plugin` workspace package

> **Status:** pending

## Overview

Create a new workspace package `@newsletter/eslint-plugin` at `packages/eslint-plugin/` with the same tooling as the other packages (tsup build, tsc typecheck, eslint lint, vitest test). Ship an empty rules object and wire the plugin into the root `eslint.config.mjs` so later phases can add rules incrementally without any more plumbing work. No rules are implemented in this phase — this is pure scaffolding.

## Implementation

**Files to create:**
- `packages/eslint-plugin/package.json`
- `packages/eslint-plugin/tsconfig.json`
- `packages/eslint-plugin/tsup.config.ts`
- `packages/eslint-plugin/vitest.config.ts`
- `packages/eslint-plugin/eslint.config.mjs` — lints the plugin's own code, extending the root config
- `packages/eslint-plugin/src/index.ts` — plugin export shape `{ meta, rules }` with empty `rules: {}` cast through a typed record
- `packages/eslint-plugin/src/utils/create-rule.ts` — `ESLintUtils.RuleCreator` wrapper that sets `meta.docs.url` to a GitHub-relative path
- `packages/eslint-plugin/tests/meta.test.ts` — structural test walking `plugin.rules` (empty for now, but the walker runs and exits 0)
- `packages/eslint-plugin/docs/rules/README.md` — decision tree: "when to use `no-restricted-imports` vs custom rule vs `check-repo-invariants`"
- `packages/eslint-plugin/README.md` — one-paragraph description

**Files to modify:**
- `eslint.config.mjs` (root) — import the plugin from `@newsletter/eslint-plugin` and register under `plugins: { newsletter }` with no rules enabled yet. This proves the import resolves.
- `pnpm-workspace.yaml` — already includes `packages/*`, nothing to change.

**Pattern to follow:**
- `packages/shared/package.json` for the `exports` map, scripts, tsup/tsc build
- `packages/shared/tsconfig.json` for tsconfig structure
- `packages/pipeline/vitest.config.ts` for test setup (but keep it minimal — no e2e project needed)

**Dependencies to add** (exact versions only, per `.claude/rules/tooling.md`):
- `devDependencies`:
  - `@typescript-eslint/utils` — same family as `typescript-eslint@8.58.0` at the root (verify via context7 or npm that 8.58.0 is available for `@typescript-eslint/utils` — if not, pin the nearest)
  - `@typescript-eslint/rule-tester` — same version
  - `typescript`, `tsup`, `vitest` — reuse root devDep versions
  - `eslint` — peer dep + devDep for testing

**What to test (RuleTester unit):**
- `tests/meta.test.ts` imports the plugin and asserts:
  - `plugin.meta.name === "@newsletter/eslint-plugin"`
  - `plugin.meta.version` is a non-empty string
  - `typeof plugin.rules === "object"` (may be empty now)
  - For every entry in `plugin.rules`, `meta.docs.url`, `meta.docs.description`, and `meta.messages` exist AND the file at `docs/rules/<rule-name>.md` exists on disk
  - (This test will activate real coverage once Phase 2 adds the first rule.)

**Traces to:** REQ-001, REQ-002, REQ-003, REQ-005, REQ-010, REQ-011, REQ-012, REQ-090

**What to build:**

1. **`packages/eslint-plugin/package.json`** — workspace package named `@newsletter/eslint-plugin`, `private: true`, `type: "module"`, exports `./dist/index.js` / `./dist/index.d.ts`, scripts matching the other packages (`build`, `dev`, `typecheck`, `lint`, `test`, `test:unit`).

2. **`packages/eslint-plugin/src/index.ts`** — exports default:
   ```ts
   import type { TSESLint } from "@typescript-eslint/utils";
   import { name, version } from "../package.json" with { type: "json" };

   export const plugin: TSESLint.FlatConfig.Plugin = {
     meta: { name, version },
     rules: {},
   };

   export default plugin;
   ```
   (If `with { type: "json" }` import assertion doesn't typecheck cleanly, hardcode the literal name/version strings and add a TODO to unify later — do not introduce a custom build step just for this.)

3. **`packages/eslint-plugin/src/utils/create-rule.ts`** — helper used by every rule in later phases:
   ```ts
   import { ESLintUtils } from "@typescript-eslint/utils";
   export const createRule = ESLintUtils.RuleCreator(
     (name) => `https://github.com/vertexcover-io/newsletter/blob/main/packages/eslint-plugin/docs/rules/${name}.md`,
   );
   ```

4. **`packages/eslint-plugin/tests/meta.test.ts`** — the structural walker. Uses `fs.existsSync` to verify docs pages for every rule. Imports plugin from `../src/index.js` (dev-import the source, not the built dist).

5. **`packages/eslint-plugin/docs/rules/README.md`** — the decision tree:
   ```markdown
   # Newsletter ESLint Rules

   ## Where to put a new rule

   1. **Can it be expressed with `no-restricted-imports`?** (forbidding specific imports in specific paths)
      → Add a block to the root `eslint.config.mjs`. No code needed.

   2. **Does it need AST matching or type information?**
      → Add a custom rule under `packages/eslint-plugin/src/rules/<name>.ts`. Include a docs page at `docs/rules/<name>.md` and a RuleTester test at `tests/rules/<name>.test.ts`.

   3. **Is it a file-shape / package.json / env / directory structure check?** (not source code)
      → Add a check to `tools/check-repo-invariants.ts`. Not an ESLint rule.

   ## Rule index
   (Populated as rules are added.)
   ```

6. **Root `eslint.config.mjs` modification:** add the plugin import alongside the existing config. The rules object for the `newsletter` namespace stays empty in Phase 1.

**Commit:** `feat(VER): scaffold @newsletter/eslint-plugin workspace package`

## Done When

- [ ] `pnpm install` resolves the new package
- [ ] `pnpm --filter @newsletter/eslint-plugin build` produces `dist/index.js` + `dist/index.d.ts`
- [ ] `pnpm --filter @newsletter/eslint-plugin typecheck` exits 0
- [ ] `pnpm --filter @newsletter/eslint-plugin lint` exits 0
- [ ] `pnpm --filter @newsletter/eslint-plugin test:unit` exits 0 (meta walker passes with empty rules)
- [ ] `pnpm lint` at root picks up the plugin import without error
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` still pass monorepo-wide
- [ ] `docs/rules/README.md` exists with the decision tree
