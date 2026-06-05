---
governs: packages/eslint-plugin/src/
last_verified_sha: ad0153a
key_files: [src/index.ts, src/rules/collector-return-shape.ts, src/rules/enforce-repository-access.ts, src/utils/create-rule.ts]
flow_fns: [src/rules/collector-return-shape.ts::rule, src/rules/enforce-repository-access.ts::rule]
decisions: []
status: active
---

# eslint-plugin — custom ESLint rules enforcing project architecture

## Purpose

Custom ESLint plugin (`@newsletter/eslint-plugin`) with two type-aware rules that enforce monorepo architecture boundaries at lint time. Integrated into the root `eslint.config.mjs` and runs via `pnpm lint` in CI.

## Public surface

- Plugin entry (`src/index.ts`) — exports `rules` and `configs`; registers `newsletter/collector-return-shape` and `newsletter/enforce-repository-access`
- `createRule(meta)` — typed rule factory wrapping `ESLintUtils.RuleCreator`, enforces `defaultOptions: []` and typed `create(context, options)` callbacks

### Rules

- **`newsletter/collector-return-shape`** (severity: `error`) — type-aware rule that verifies every collector function returns `CollectorResult` (not a raw array). Flags functions whose return type is not assignable to `CollectorResult`. Applies only to files in `packages/pipeline/src/collectors/`.
- **`newsletter/enforce-repository-access`** (severity: `error`) — **value** imports of `drizzle-orm` / `@newsletter/shared/db` (and their subpaths `drizzle-orm/*`, `@newsletter/shared/db/*`) are only allowed inside repository modules. **Type-only imports are explicitly allowed everywhere** — the rule skips both `import type { … }` declarations (`node.importKind === "type"`) and declarations whose specifiers are all type-only. Applies to `packages/api/src/**` and `packages/pipeline/src/**`; exemptions for paths containing `/repositories/`, `/tests/`, or matching `*.test.ts(x)`. The report message names the package-correct expected repo dir (`packages/api/src/repositories/` vs `packages/pipeline/src/repositories/`).

## Depends on / used by

Uses: `@typescript-eslint/utils` (ESLintUtils, ASTUtils), `typescript` (type checker)
Used by: root `eslint.config.mjs` (via `newsletter` plugin import)

## Data flows

```
collector-return-shape rule:
  Program node → check file path against packages/pipeline/src/collectors/
    ├─ not in collectors/ → return {} (no-op)
    └─ in collectors/ → visit FunctionDeclaration / ArrowFunctionExpression (top-level)
        → get type of return statement → checker.isTypeAssignableTo(returnType, CollectorResult)
          ├─ assignable → pass
          └─ not assignable → report: "Collector must return CollectorResult"

enforce-repository-access rule (src/rules/enforce-repository-access.ts::create):
  ImportDeclaration(node) → source = node.source.value
    ├─ !isRestrictedSource(source) → return (pass)   # not drizzle-orm[/*] / @newsletter/shared/db[/*]
    ├─ node.importKind === "type" → return (whole `import type {…}` allowed)
    ├─ every specifier is ImportSpecifier with importKind==="type" → return (all-type-only allowed)
    └─ value import of restricted source →
        filename includes "/repositories/" | "/tests/" | matches *.test.ts(x) → return (exempt)
        else → expected = filename includes "/packages/api/"
                 ? "packages/api/src/repositories/"
                 : "packages/pipeline/src/repositories/"
             → context.report(messageId: "repositoryOnly", data:{source, expected})
```

## Gotchas / landmines

- **Rules are type-aware** — they require `parserOptions.project` in the ESLint config pointing to each package's `tsconfig.json`. Without this, the `createRule` factory throws at rule initialization.
- **`enforce-repository-access` deliberately exempts type-only imports.** The rule short-circuits on `node.importKind === "type"` AND on declarations whose specifiers are all `importKind === "type"`, so `import type { … } from "drizzle-orm"` is allowed everywhere — only *value* imports outside repository modules are reported. (The doc previously claimed the opposite; corrected ad0153a.)
- **Restricted-source matching includes subpaths.** `isRestrictedSource` matches `@newsletter/shared/db`, `drizzle-orm`, and any `…/`-prefixed subpath of either — not just the bare specifier.
- **`create-rule.ts` doc URL is hard-coded** to `github.com/vertexcover-io/newsletter/blob/main/packages/eslint-plugin/docs/rules/<name>.md` — rule names must have a matching markdown file under `packages/eslint-plugin/docs/rules/` for the generated link to resolve.
