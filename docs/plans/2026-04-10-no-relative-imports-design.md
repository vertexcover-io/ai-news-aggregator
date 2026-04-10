# no-relative-imports ESLint Rule — Design

## Problem Statement

Internal imports within service packages use parent-traversal relative paths (`../lib/validate.js`, `../repositories/raw-items.js`). These are harder to read than path-alias equivalents, break silently when files move, and are inconsistent — the pipeline package already uses zero relative imports while api and shared use them throughout.

## Context

The monorepo has four packages. Each backend package already defines a TypeScript path alias:
- `packages/api`: `@api/*` → `src/*`
- `packages/pipeline`: `@pipeline/*` → `src/*`
- `packages/shared`: `@shared/*` → `src/*`
- `packages/web`: no path alias (Vite, no tsconfig paths)

Current relative import count by package:
- `api`: ~10 parent-traversal `../` imports
- `pipeline`: **0** (already compliant)
- `shared`: ~14, all barrel re-exports (`export * from "./schema.js"`) and type references
- `web`: a few same-dir imports (`./pages/RunPage`, `./client`)
- `eslint-plugin`: internal rule imports (`./rules/collect-return-shape.js`)

The project already has a custom `@newsletter/eslint-plugin` with 5 rules following a consistent pattern, providing auto-fix capability and tailored error messages.

## Requirements

### Functional Requirements
1. Flag `../` (parent-traversal) relative imports inside `packages/api/src/**/*.ts`
2. Flag `../` relative imports inside `packages/pipeline/src/**/*.ts` (future-proofing)
3. Provide an auto-fix that converts `../lib/validate.js` → `@api/lib/validate.js` (or `@pipeline/`)
4. Error message names the alias the developer should use instead
5. Rule is registered in `@newsletter/eslint-plugin` following the existing `createRule` pattern
6. Enabled in `eslint.config.mjs` at the appropriate file globs

### Non-Functional Requirements
- Zero false positives on `./` (same-dir) imports — these are idiomatic for barrels
- No impact on `packages/shared`, `packages/web`, or `packages/eslint-plugin`
- Auto-fix must be idempotent (running twice produces the same result)
- Rule must not require type information (simpler, faster — no `parserServices` needed)

### Edge Cases and Boundary Conditions
- `export * from "../db/schema.js"` — re-export with `../`, must be flagged and fixed
- `import type { Foo } from "../lib/types.js"` — type-only imports must also be flagged
- `"../../../something"` — deep traversal must resolve correctly to the alias path
- Files inside `packages/api/src/repositories/**` — still in scope (rule covers all of `src/`)
- Test files (`**/*.test.ts`) — still in scope (consistency enforced everywhere)

## Key Insights

1. **`./` is not the problem; `../` is.** Same-dir imports (`./client.js`, `./schema.js`) are standard TypeScript barrel syntax. Banning them would flag idiomatic library code in `shared` and create noise with no readability benefit. Only parent-traversal crosses conceptual module boundaries.

2. **web and eslint-plugin cannot be included without extra setup.** `web` has no `@web/*` tsconfig path and no Vite alias — adding the rule there would require first defining paths in `tsconfig.app.json` and `vite.config.ts`. `eslint-plugin` has no path alias either. Scope to api + pipeline only.

3. **No external plugin needed.** `eslint-plugin-import`'s `import/no-relative-parent-imports` would work but adds a dependency, doesn't auto-fix, and doesn't provide the alias suggestion. The custom plugin pattern already handles this project's needs better.

4. **Auto-fix is straightforward.** Given the file's path within `packages/api/src/`, the alias path is: strip `packages/api/src/` prefix from the resolved absolute path, then prepend `@api/`. The resolution: take the import source (e.g. `../lib/validate.js`), resolve it relative to the importing file, compute the relative portion from `src/`, and prepend the alias.

5. **Built-in `no-restricted-imports` is insufficient.** It can ban patterns but cannot auto-fix or suggest the correct alias. A custom rule is required for the auto-fix requirement.

## Architectural Challenges

**Alias resolution in the rule**: The rule must compute the correct alias path from the importing file's location. It does not need the TypeScript compiler — it can use Node's `path` module:
1. Get the importing file's absolute path from ESLint's `context.getFilename()`
2. Resolve the relative import specifier against that path
3. Find `packages/<pkg>/src/` in the resolved path
4. Build `@<pkg>/<rest>` from the portion after `src/`

This is pure path arithmetic — no type checker required.

## Approaches Considered

### Approach A: Built-in `no-restricted-imports` with patterns
Ban `../` via `{ patterns: [{ group: ["../*", "../../*"], message: "Use @api/* alias" }] }` in `eslint.config.mjs`.

- **Pros**: Zero code to write, immediate
- **Cons**: No auto-fix, generic error message (doesn't tell you the right alias), requires listing every depth pattern (`../*`, `../../*`, etc.), or using a regex via custom rule

### Approach B: Custom rule `newsletter/no-relative-imports` (chosen)
A new rule in `@newsletter/eslint-plugin` that detects `../` imports, computes the correct alias, reports with a descriptive message, and provides an auto-fix.

- **Pros**: Auto-fix, precise error message with the correct replacement, scoped to the specific packages, follows existing plugin pattern
- **Cons**: ~80 lines of rule code to write + tests

### Approach C: External `eslint-plugin-import`
Add `eslint-plugin-import` and enable `import/no-relative-parent-imports`.

- **Pros**: Battle-tested rule
- **Cons**: New dependency (heavy plugin), no auto-fix, no alias suggestion, doesn't fit project pattern of keeping external deps minimal

## Chosen Approach

**Approach B — custom rule `newsletter/no-relative-imports`.**

Rationale: the project already has the plugin infrastructure and the pattern is established. Auto-fix is the main requirement and only a custom rule can provide it. The implementation is simple path arithmetic with no type-checker dependency.

## High-Level Design

```
eslint.config.mjs
  └── { files: ["packages/api/src/**/*.ts", "packages/pipeline/src/**/*.ts"] }
        rule: newsletter/no-relative-imports → error

packages/eslint-plugin/src/rules/no-relative-imports.ts
  ├── Selector: ImportDeclaration, ExportNamedDeclaration (with source)
  ├── Check: source.value starts with ".."
  ├── Compute alias: resolve(dirname(filename), source) → strip packages/<pkg>/src/ → prepend @<pkg>/
  ├── Report: "Use '@api/lib/validate.js' instead of relative import"
  └── Fix: replace source text with computed alias (preserving .js extension)
```

**Alias map (derived at rule runtime from file path):**
| Package dir fragment | Alias prefix |
|---|---|
| `packages/api/src/` | `@api/` |
| `packages/pipeline/src/` | `@pipeline/` |

**No change needed to tsconfig paths** — `@api/*` and `@pipeline/*` are already defined.

## Open Questions

- Should the rule also fix existing violations automatically as part of this PR (via `pnpm lint --fix`)? Yes — since it's auto-fixable and only ~10 violations exist in api, this is a no-op cost.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Path resolution produces wrong alias (e.g. on Windows with `\` separators) | Use `path.posix` normalization; test on the actual file paths in the repo |
| `.js` extension dropped or doubled in auto-fix | Preserve the exact specifier extension from the original source value |
| Rule fires in test files unnecessarily | Tests are inside `src/**` scope intentionally — consistency is enforced everywhere, same as other rules |

## Assumptions

- `@api/*` and `@pipeline/*` tsconfig path aliases continue to be resolved by tsup (build) and tsx (dev) — this has been true since the monorepo was set up.
- The rule is not needed for `web` in this PR — a follow-up could add `@web/*` Vite aliases and then enable the rule there.
- The eslint-plugin's own internal relative imports (`./rules/collector-return-shape.js`) remain exempt — the plugin package has no path aliases.
