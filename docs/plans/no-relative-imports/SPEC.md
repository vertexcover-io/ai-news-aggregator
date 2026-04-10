# SPEC: no-relative-imports ESLint Rule

**Source:** docs/plans/2026-04-10-no-relative-imports-design.md
**Generated:** 2026-04-10

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When ESLint processes a file matching `packages/api/src/**/*.ts`, the system shall report an error for any `ImportDeclaration` whose source starts with `..` | `pnpm lint` exits with error code 2 when a `../` import exists in `packages/api/src/**/*.ts` | Must |
| REQ-002 | Event-driven | When ESLint processes a file matching `packages/pipeline/src/**/*.ts`, the system shall report an error for any `ImportDeclaration` whose source starts with `..` | `pnpm lint` exits with error code 2 when a `../` import exists in `packages/pipeline/src/**/*.ts` | Must |
| REQ-003 | Event-driven | When ESLint processes a file matching `packages/api/src/**/*.ts`, the system shall report an error for any `ExportNamedDeclaration` with a source that starts with `..` | `export * from "../db/schema.js"` in api src is flagged | Must |
| REQ-004 | Ubiquitous | The system shall provide an auto-fix for each violation that replaces the relative specifier with the package path alias (`@api/` or `@pipeline/`) | Running `pnpm lint --fix` converts `../lib/validate.js` to `@api/lib/validate.js` with exit code 0 | Must |
| REQ-005 | Ubiquitous | The system shall compute the alias path by resolving the relative specifier to an absolute path and stripping the `packages/<pkg>/src/` prefix to prepend `@<pkg>/` | `../lib/validate.js` from `packages/api/src/routes/runs.ts` becomes `@api/lib/validate.js` | Must |
| REQ-006 | Ubiquitous | The error message shall name the correct alias path the developer should use | Error message contains the expected alias string (e.g. `Use '@api/lib/validate.js' instead`) | Must |
| REQ-007 | Ubiquitous | The system shall not flag `ImportDeclaration` nodes whose source starts with `./` (same-directory imports) | `import { schema } from "./schema.js"` produces no lint error | Must |
| REQ-008 | Ubiquitous | The system shall not flag any imports in `packages/shared/**`, `packages/web/**`, or `packages/eslint-plugin/**` | Barrel re-exports in shared and internal rule imports in eslint-plugin produce no lint errors | Must |
| REQ-009 | Ubiquitous | The rule shall be registered in `@newsletter/eslint-plugin` as `newsletter/no-relative-imports` following the existing `createRule` pattern | `import newsletter from "@newsletter/eslint-plugin"; newsletter.rules["no-relative-imports"]` is defined | Must |
| REQ-010 | Ubiquitous | The rule shall be enabled in `eslint.config.mjs` at severity `"error"` for `packages/api/src/**/*.ts` and `packages/pipeline/src/**/*.ts` | `eslint.config.mjs` contains a config block with the correct `files` glob and rule set to `"error"` | Must |
| REQ-011 | Ubiquitous | The auto-fix shall preserve the original file extension from the import specifier | If original is `../lib/validate.js`, the fix is `@api/lib/validate.js` (not `@api/lib/validate`) | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | `import type { Foo } from "../lib/types.js"` — type-only import with `../` | Flagged and auto-fixed to `@api/lib/types.js` | REQ-001, REQ-004 |
| EDGE-002 | `export * from "../db/schema.js"` — re-export with `../` | Flagged (REQ-003) and auto-fixed to `@api/db/schema.js` | REQ-003, REQ-004 |
| EDGE-003 | `import foo from "../../../deeply/nested.js"` — multi-level traversal | Resolved correctly; alias path is `@api/deeply/nested.js` | REQ-005 |
| EDGE-004 | File is in `packages/api/src/repositories/raw-items.ts` — subdirectory within api | Rule fires; file is within the `packages/api/src/**` glob | REQ-001 |
| EDGE-005 | File is a test file `packages/api/src/services/foo.test.ts` | Rule fires; test files within `src/**` are in scope | REQ-001 |
| EDGE-006 | `import { apiFetch } from "./client"` in `packages/web/src/api/runs.ts` | No error — web is out of scope | REQ-008 |
| EDGE-007 | `export * from "./schema.js"` in `packages/shared/src/db/index.ts` | No error — shared is out of scope | REQ-008 |
| EDGE-008 | `import collectorReturnShape from "./rules/collector-return-shape.js"` in eslint-plugin | No error — eslint-plugin is out of scope | REQ-008 |
| EDGE-009 | Running `pnpm lint --fix` twice produces the same result (idempotency) | Second run reports 0 violations and makes no further changes | REQ-004 |
| EDGE-010 | `packages/pipeline/src/**/*.ts` currently has 0 violations | Rule is enabled but produces no errors; future additions are caught | REQ-002 |

## Verification Matrix

| REQ/EDGE ID | Unit Test | Integration Test | Manual Test | Notes |
|-------------|-----------|-----------------|-------------|-------|
| REQ-001 | Yes | No | No | RuleTester: `../` in api-scoped file |
| REQ-002 | Yes | No | No | RuleTester: `../` in pipeline-scoped file |
| REQ-003 | Yes | No | No | RuleTester: `export * from "../..."` |
| REQ-004 | Yes | No | No | RuleTester: verify `output` field in valid fix case |
| REQ-005 | Yes | No | No | RuleTester: assert exact alias string in message and fix |
| REQ-006 | Yes | No | No | RuleTester: assert `message` contains alias path |
| REQ-007 | Yes | No | No | RuleTester: `./` import in valid cases |
| REQ-008 | Yes | No | No | RuleTester with filename set to shared/web/eslint-plugin path |
| REQ-009 | Yes | No | No | Check plugin exports in index test or integration |
| REQ-010 | No | No | Yes | Verify `pnpm lint` flags existing `../` in api; manual check |
| REQ-011 | Yes | No | No | RuleTester: assert fix output preserves `.js` extension |
| EDGE-001 | Yes | No | No | RuleTester: `import type` case |
| EDGE-002 | Yes | No | No | RuleTester: `export * from` case |
| EDGE-003 | Yes | No | No | RuleTester: `../../../` traversal |
| EDGE-004 | Yes | No | No | RuleTester: filename set to repositories subdirectory |
| EDGE-005 | Yes | No | No | RuleTester: filename set to `*.test.ts` |
| EDGE-006 | Yes | No | No | RuleTester: `./` import in web-scoped file |
| EDGE-007 | Yes | No | No | RuleTester: `./` re-export in shared-scoped file |
| EDGE-008 | Yes | No | No | RuleTester: `./` import in eslint-plugin file |
| EDGE-009 | No | No | Yes | Run `pnpm lint --fix` twice; second run must be clean |
| EDGE-010 | No | No | Yes | Run `pnpm lint` on pipeline with no violations |

## Out of Scope

- Enforcing absolute imports in `packages/web/**` — web has no `@web/*` tsconfig/Vite alias configured; requires a separate setup PR
- Enforcing absolute imports in `packages/shared/**` — library barrel re-exports (`export * from "./schema.js"`) are idiomatic and should not be banned
- Enforcing absolute imports in `packages/eslint-plugin/**` — the plugin has no path aliases; would require adding them first
- Banning `./` (same-directory) imports anywhere — these are idiomatic for barrel files and local module cohesion
- Cross-package import enforcement — already handled by `no-restricted-imports` rules in `eslint.config.mjs`
- Fixing violations in `packages/shared` or `packages/web` as part of this PR
