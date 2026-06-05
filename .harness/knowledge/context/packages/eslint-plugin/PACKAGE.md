---
governs: packages/eslint-plugin/src/
last_verified_sha: 5a2ff20
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
- **`newsletter/enforce-repository-access`** (severity: `error`) — value imports of `drizzle-orm` and `@newsletter/shared/db` are only allowed inside repository files. Applies to `packages/api/src/**` and `packages/pipeline/src/**`; exemptions for files in `repositories/` directories.

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

enforce-repository-access rule:
  ImportDeclaration → check import source
    ├─ source is "drizzle-orm" or "@newsletter/shared/db"
    │   → check if file is in repositories/ dir
    │     ├─ yes → pass
    │     └─ no → report: "drizzle-orm and @newsletter/shared/db can only be imported from repository files"
    └─ not restricted → pass
```

## Gotchas / landmines

- **Rules are type-aware** — they require `parserOptions.project` in the ESLint config pointing to each package's `tsconfig.json`. Without this, the `createRule` factory throws at rule initialization.
- **`enforce-repository-access` checks the file path, not the import kind.** Value imports are blocked but type-only imports could pass — the rule checks actual `ImportDeclaration` nodes, not `import type` vs `import`.
