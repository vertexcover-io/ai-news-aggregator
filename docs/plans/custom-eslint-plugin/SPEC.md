# SPEC: Custom ESLint Plugin (`@newsletter/eslint-plugin`)

**Source:** `docs/plans/2026-04-09-custom-eslint-plugin-design.md`
**Generated:** 2026-04-09

## Requirements

### Package scaffolding and integration

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall expose a workspace package named `@newsletter/eslint-plugin` located at `packages/eslint-plugin/`. | `pnpm -r exec node -e "require('@newsletter/eslint-plugin')"` resolves from the root without error. | Must |
| REQ-002 | Ubiquitous | The plugin package shall export a default object with `meta.name`, `meta.version`, and a `rules` record keyed by rule name. | `import newsletter from "@newsletter/eslint-plugin"` yields an object where `newsletter.meta.name === "@newsletter/eslint-plugin"` and `typeof newsletter.rules === "object"`. | Must |
| REQ-003 | Ubiquitous | The plugin package shall be written in TypeScript with strict mode enabled and shall build to `dist/` via the same toolchain as other packages. | `pnpm --filter @newsletter/eslint-plugin build` exits 0 and produces `dist/index.js` and `dist/index.d.ts`. | Must |
| REQ-004 | Event-driven | When `pnpm lint` runs at the repository root, the system shall load `@newsletter/eslint-plugin` from the root `eslint.config.mjs` and execute all configured rules. | Introducing a known violation of any v1 custom rule causes `pnpm lint` to report a diagnostic whose `ruleId` starts with `newsletter/`. | Must |
| REQ-005 | Ubiquitous | The plugin package shall provide unit tests using `@typescript-eslint/rule-tester` runnable via `pnpm --filter @newsletter/eslint-plugin test:unit`. | `pnpm --filter @newsletter/eslint-plugin test:unit` exits 0 with at least one `valid` case and one `invalid` case per shipped custom rule. | Must |

### Rule authoring conventions

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Ubiquitous | Every custom rule shall define `meta.type`, `meta.docs.description`, `meta.docs.url`, and `meta.messages`. | Static assertion in `tests/rules/meta.test.ts` walks `newsletter.rules` and fails if any rule is missing any of those fields. | Must |
| REQ-011 | Ubiquitous | Every custom rule's `meta.docs.url` shall resolve to an existing markdown file under `packages/eslint-plugin/docs/rules/<rule-name>.md`. | The same meta test asserts `fs.existsSync` for each rule's documented path. | Must |
| REQ-012 | Ubiquitous | Every custom rule shall have at least one `valid` and one `invalid` `RuleTester` fixture. | `tests/rules/coverage.test.ts` asserts each entry of `newsletter.rules` has a matching test file that registered both case kinds. | Must |
| REQ-013 | Ubiquitous | Rules shall not hardcode absolute or package-relative file paths in their logic; path scoping shall be done via flat-config `files` globs in `eslint.config.mjs`. | Review checklist item; enforced by inspection during PR review (no automated test). | Should |
| REQ-014 | Ubiquitous | Every custom rule added to `eslint.config.mjs` shall start at severity `"warn"`. | Grep of `eslint.config.mjs` for any entry matching `newsletter/...: "error"` is only permitted when accompanied by a promotion PR link in the commit message. | Must |

### Layer 1 — declarative boundary rules (via `no-restricted-imports`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Unwanted | If a file under `packages/pipeline/**` imports from `hono`, `express`, or `fastify`, then the system shall report a lint error on the import statement. | RuleTester-free fixture: a temp file under `packages/pipeline/src/` importing `hono` causes `pnpm lint` to emit `no-restricted-imports` with a message containing "HTTP framework". | Must |
| REQ-021 | Unwanted | If a file under `packages/pipeline/**` imports from `@newsletter/api`, then the system shall report a lint error on the import statement. | Fixture: pipeline file importing `@newsletter/api` causes `pnpm lint` to emit `no-restricted-imports` with message containing "Pipeline cannot depend on API". | Must |
| REQ-022 | Unwanted | If a file under `packages/web/**` imports from `drizzle-orm` or any `@newsletter/shared/db` path, then the system shall report a lint error on the import statement. | Fixture: web component importing `drizzle-orm` causes `pnpm lint` to emit `no-restricted-imports` with a message referencing "web package". | Must |
| REQ-023 | Unwanted | If a file under `packages/api/src/routes/**` imports from `@newsletter/shared/db` or `drizzle-orm` directly, then the system shall report a lint error on the import statement. | Fixture: route handler importing `@newsletter/shared/db` causes `pnpm lint` to emit `no-restricted-imports` with a message referencing "route handlers". | Must |

### Layer 2 — custom AST rules (v1)

#### `newsletter/dotenv-bootstrap`

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Unwanted | If a file matched by the rule scope does not begin with an import of `dotenv` followed by a call to `config({ path: "../../.env" })` as its first two top-level statements, then the rule shall report on the `Program` node. | RuleTester `invalid` case: file whose first statement is a different import reports `newsletter/dotenv-bootstrap` with messageId `missingBootstrap`. Valid case: file starting with the exact two-statement bootstrap passes. | Must |
| REQ-031 | Ubiquitous | The rule shall be scoped via `eslint.config.mjs` to package entrypoint files only (`packages/*/src/index.ts`). | `eslint.config.mjs` contains a `files` block listing exactly `packages/*/src/index.ts` for this rule. | Must |
| REQ-032 | Unwanted | If the first statement is `import { config } from "dotenv"` but the second statement is a `config(...)` call without a `path` property equal to `"../../.env"`, then the rule shall report messageId `wrongPath`. | RuleTester invalid case covers this. | Must |

#### `newsletter/no-bundled-readfilesync`

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Unwanted | If a `readFileSync` call's first argument is a `new URL(..., import.meta.url)` expression, then the rule shall report messageId `bundledUrlRead`. | RuleTester invalid case. | Must |
| REQ-041 | Unwanted | If a `readFileSync` call's first argument contains an identifier named `__dirname`, then the rule shall report messageId `bundledDirnameRead`. | RuleTester invalid case. | Must |
| REQ-042 | Ubiquitous | The rule shall match `readFileSync` regardless of whether it is imported as `fs.readFileSync`, `readFileSync` (named), or aliased. | RuleTester valid/invalid cases cover all three import shapes. | Should |
| REQ-043 | Ubiquitous | The rule shall be scoped via `eslint.config.mjs` to `packages/pipeline/src/**` and `packages/api/src/**`. | `eslint.config.mjs` files block matches. | Must |

#### `newsletter/enforce-repository-access`

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Unwanted | If a file outside `**/repositories/**` and outside `**/tests/**` imports from `@newsletter/shared/db` or any subpath thereof, then the rule shall report messageId `repositoryOnly`. | RuleTester invalid case: service file importing `@newsletter/shared/db`. Valid case: repository file importing the same path. | Must |
| REQ-051 | Unwanted | If a file outside `**/repositories/**` and outside `**/tests/**` imports from `drizzle-orm`, then the rule shall report messageId `repositoryOnly`. | RuleTester invalid case. | Must |
| REQ-052 | Ubiquitous | The rule shall be scoped via `eslint.config.mjs` to `packages/api/src/**` and `packages/pipeline/src/**` only. | `eslint.config.mjs` files block matches. | Must |
| REQ-053 | Ubiquitous | The rule's error message shall name the file that would be the correct repository location pattern (e.g. `"move this query into packages/pipeline/src/repositories/"`). | RuleTester invalid case asserts the reported message contains the substring `repositories/`. | Should |

**Clarification (2026-04-09):** Type-only imports (`import type { ... }`) from `@newsletter/shared/db` and `drizzle-orm` are allowed in all files. Only value imports are flagged. Rationale: the repository pattern guards *runtime* DB access, not the type system. Schema types (e.g. `RawItemInsert`, `AppDb`) are legitimate cross-cutting types used by collectors, tests, and fixtures.

#### `newsletter/collector-return-shape`

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Unwanted | If an exported function declared in `packages/pipeline/src/collectors/**` has a return type that is not assignable to `Promise<CollectorResult>`, then the rule shall report messageId `wrongReturnType`. | Type-aware RuleTester invalid case. Valid case: a collector returning `Promise<CollectorResult>`. | Must |
| REQ-061 | Ubiquitous | The rule shall use `ESLintUtils.getParserServices(context)` and `services.getTypeAtLocation` to resolve the function's return type. | Implementation inspection during review; no separate runtime assertion. | Must |
| REQ-062 | Ubiquitous | The rule shall be scoped via `eslint.config.mjs` to `packages/pipeline/src/collectors/**`. | `eslint.config.mjs` files block matches. | Must |

#### `newsletter/no-raw-alter-table`

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-070 | Unwanted | If a `db.execute(...)` call is invoked with a template literal or string argument whose value matches the case-insensitive pattern `/ALTER\s+TABLE/`, then the rule shall report messageId `rawAlterTable`. | RuleTester invalid case covers both template literal and string literal forms. | Must |
| REQ-071 | Ubiquitous | The rule shall be scoped via `eslint.config.mjs` to `packages/api/src/**` and `packages/pipeline/src/**`. | `eslint.config.mjs` files block matches. | Must |

### Documentation and workflow

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-090 | Ubiquitous | The system shall provide `packages/eslint-plugin/docs/rules/README.md` with a decision tree explaining when to use `no-restricted-imports` vs. a custom rule. | File exists and contains the two-branch decision tree. | Must |
| REQ-091 | Ubiquitous | Each `.claude/rules/learnings/*.md` file whose content is enforced by a rule shall gain a footer line of the form `Enforced by: newsletter/<rule-name>`. | Grep check: for every file listed in the design doc's "Layer 2" mapping, the corresponding learning file contains the footer. | Should |
| REQ-092 | Ubiquitous | The `/extract-learnings` skill shall be updated to draft a rule stub in `packages/eslint-plugin/src/rules/` when a new learning is mechanically enforceable. | The skill file under `.claude/skills/extract-learnings` (or wherever it lives) shows a commit modifying its instructions to include this step. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | A package entrypoint file uses a CommonJS `require("dotenv")` instead of an ESM `import`. | `newsletter/dotenv-bootstrap` reports `missingBootstrap` — only the exact ESM two-line form is accepted. | REQ-030 |
| EDGE-002 | A pipeline file imports `hono/client` (subpath) rather than bare `hono`. | `no-restricted-imports` is configured with `patterns: ["hono", "hono/*"]` so subpath imports are also blocked. | REQ-020 |
| EDGE-003 | A test file under `packages/api/tests/**` imports `@newsletter/shared/db` for fixture setup. | `newsletter/enforce-repository-access` is scoped by flat-config to exclude `**/tests/**`, so the import is allowed. | REQ-050, REQ-052 |
| EDGE-004 | A dev script at `packages/pipeline/src/scripts/demo-web-collector.ts` legitimately calls `readFileSync` on a fixture path built from `import.meta.url`. | Author adds `// eslint-disable-next-line newsletter/no-bundled-readfilesync -- dev-only script, not bundled` with the rationale required by the rule docs. | REQ-040 |
| EDGE-005 | A collector function's return type is an alias that resolves to `Promise<CollectorResult>` via a `type Foo = CollectorResult`. | `services.getTypeAtLocation` resolves the alias; the rule accepts it. | REQ-060 |
| EDGE-006 | A repository file under `packages/pipeline/src/repositories/` accidentally imports `hono`. | The repository-access rule says nothing, but the pipeline-wide `no-restricted-imports` for `hono` still fires. | REQ-020 |
| EDGE-010 | A `db.execute` call passes a variable (not a literal) whose value contains `ALTER TABLE` at runtime. | `no-raw-alter-table` only checks literal/template arguments; variable-tracking is out of scope. Runtime remains unprotected by this rule. | REQ-070 |
| EDGE-012 | Flat-config `files` glob accidentally matches a `.d.ts` declaration file inside `packages/pipeline/src/collectors/`. | The `collector-return-shape` rule bails out early if the file extension is `.d.ts` (no executable code to check). | REQ-060 |
| EDGE-013 | A custom rule added to `eslint.config.mjs` accidentally at severity `"error"` before passing the promotion sprint. | REQ-014 forbids this; review catches it via the grep check described in the acceptance criterion. | REQ-014 |
| EDGE-014 | The `@newsletter/eslint-plugin` package is modified but not rebuilt, and the root lint picks up stale `dist/`. | Root lint depends on the plugin's `build` task via Turborepo's task graph, ensuring rebuild before lint. | REQ-003, REQ-004 |
| EDGE-015 | `RuleTester` throws because its internal `parserOptions.project` is not set for a type-aware rule fixture. | Test file for `collector-return-shape` configures `RuleTester` with `languageOptions.parserOptions.projectService: true` and passes a `tsconfig.json` under `packages/eslint-plugin/tests/fixtures/`. | REQ-060 |

## Verification Matrix

| ID | Unit Test | Integration Test | Manual Test | Notes |
|----|-----------|------------------|-------------|-------|
| REQ-001 | No | Yes | No | Integration = `pnpm -r exec` resolving the package |
| REQ-002 | Yes | No | No | Import-shape assertion |
| REQ-003 | No | Yes | No | `pnpm --filter ... build` in CI |
| REQ-004 | No | Yes | No | Fixture-based lint invocation |
| REQ-005 | Yes | No | No | RuleTester suite |
| REQ-010 | Yes | No | No | Meta walker test |
| REQ-011 | Yes | No | No | Meta walker test |
| REQ-012 | Yes | No | No | Coverage test |
| REQ-013 | No | No | Yes | Review checklist |
| REQ-014 | No | Yes | Yes | Grep in CI + review |
| REQ-020 | No | Yes | No | Fixture file + `pnpm lint` |
| REQ-021 | No | Yes | No | Fixture file + `pnpm lint` |
| REQ-022 | No | Yes | No | Fixture file + `pnpm lint` |
| REQ-023 | No | Yes | No | Fixture file + `pnpm lint` |
| REQ-030 | Yes | No | No | RuleTester |
| REQ-031 | No | Yes | No | Config grep |
| REQ-032 | Yes | No | No | RuleTester |
| REQ-040 | Yes | No | No | RuleTester |
| REQ-041 | Yes | No | No | RuleTester |
| REQ-042 | Yes | No | No | RuleTester — 3 import shapes |
| REQ-043 | No | Yes | No | Config grep |
| REQ-050 | Yes | No | No | RuleTester |
| REQ-051 | Yes | No | No | RuleTester |
| REQ-052 | No | Yes | No | Config grep |
| REQ-053 | Yes | No | No | RuleTester asserts message |
| REQ-060 | Yes | No | No | Type-aware RuleTester |
| REQ-061 | No | No | Yes | Code review |
| REQ-062 | No | Yes | No | Config grep |
| REQ-070 | Yes | No | No | RuleTester |
| REQ-071 | No | Yes | No | Config grep |
| REQ-090 | No | No | Yes | File existence + content review |
| REQ-091 | No | Yes | No | Grep check in CI |
| REQ-092 | No | No | Yes | Skill file review |
| EDGE-001 | Yes | No | No | RuleTester |
| EDGE-002 | No | Yes | No | Fixture lint |
| EDGE-003 | Yes | No | No | RuleTester valid case |
| EDGE-004 | Yes | No | No | RuleTester valid case with disable comment |
| EDGE-005 | Yes | No | No | Type-aware RuleTester |
| EDGE-006 | No | Yes | No | Fixture lint |
| EDGE-010 | Yes | No | No | RuleTester valid case with variable arg |
| EDGE-012 | Yes | No | No | RuleTester valid case on `.d.ts` |
| EDGE-013 | No | Yes | Yes | Grep + review |
| EDGE-014 | No | Yes | No | Turborepo task graph |
| EDGE-015 | Yes | No | No | RuleTester setup |

## Out of Scope

- A rule forcing Hono route handlers to be "thin" (statement-count limits, delegation-to-service heuristics). The repository-access rule covers the worst version; thickness is a review concern.
- A rule enforcing structured logging at service/worker boundaries.
- A rule enforcing that test files assert exact SPEC-mandated strings verbatim.
- Frontend-specific rules for `packages/web/**` beyond the single `no-restricted-imports` on `drizzle-orm`/`@newsletter/shared/db`.
- Repository function naming conventions (`findX`, `upsertX`, etc.).
- Variable-tracking / data-flow analysis for `no-raw-alter-table` — only literal and template-literal arguments are inspected.
- Non-AST invariant checks (`package.json` version pinning, AI SDK alignment, `vitest.config.ts` excluded from `tsc -b`, `docker`/`docker-compose` string ban). These were considered as a separate `tools/check-repo-invariants.ts` script but dropped from v1 — none of them had a forcing incident worth the tooling cost. Revisit if any of those failures actually happen.
- Publishing `@newsletter/eslint-plugin` to npm — it is a workspace-only package.
- Auto-fixing rules. Every v1 custom rule is report-only; no `fixable` metadata, no `fix` function. Auto-fix is a future enhancement.
- Rule authoring by agents without human review. Per the ownership decision, humans approve every rule PR.
- Migration of existing `.claude/rules/` content out of markdown. Markdown rules stay as human-readable docs; the plugin is a separate enforcement layer, not a replacement.
- CI pipeline integration beyond `pnpm lint` exit code (no separate SARIF upload, no GitHub annotations beyond whatever ESLint already emits).
