# Code Review #1

**Branch:** `custom-eslint-plugin`
**Base:** `358d91d`
**Commits reviewed:** 8 (1744fc8 → 48d4c18)
**Reviewer:** Sonnet (Opus 4.6 1M)
**Date:** 2026-04-09

## Verdict: APPROVE WITH SUGGESTIONS

## Summary

The work implements a `@newsletter/eslint-plugin` workspace package with 5 custom rules, a `tools/check-repo-invariants.ts` script with 4 file-shape checks, and a clean repository-pattern refactor that makes the new `enforce-repository-access` rule pass out of the box. All verification gates pass (typecheck 6/6, lint 5/5, invariants clean, 281 unit tests + 13 tools tests). SPEC traceability is high and both documented deviations (REQ-050 type-only import allowance, REQ-082 `@ai-sdk/*` drift vs strict `ai` major-match) are justified. A few minor gaps exist around test coverage for one REQ acceptance criterion, a filename-based in-rule path check that slightly tensions REQ-013, and a missing turbo task dependency that would make a cold checkout fragile.

## Critical defects

(none)

## Important defects

(none that block approval — the items in "Minor" would ideally be addressed, but none are load-bearing for correctness.)

## Minor / Suggestions

### S1 — EDGE-014 / cold-checkout fragility of the lint task

`turbo.json` defines `lint` with no `dependsOn`, and the root script chains `turbo lint && pnpm check:invariants`. Because the root `eslint.config.mjs` imports `@newsletter/eslint-plugin` from its built `dist/`, a fresh checkout that runs `pnpm lint` before `pnpm build` will fail to load the plugin. EDGE-014 in `docs/spec/custom-eslint-plugin/spec.md:118` explicitly states: "Root lint depends on the plugin's build task via Turborepo's task graph, ensuring rebuild before lint." The current wiring does not satisfy that. Phase 7 plan notes the script-level chaining was chosen over a turbo dependency for simplicity, but leaving `lint` without `dependsOn: ["^build"]` means the spec's own edge case isn't actually prevented.

- File: `turbo.json` (lint task)
- Fix: add `"lint": { "dependsOn": ["^build"] }` so the plugin is always built before the root eslint invocation.

### S2 — REQ-042 aliased-import case is not actually tested

REQ-042 says the rule "shall match `readFileSync` regardless of whether it is imported as `fs.readFileSync`, `readFileSync` (named), or aliased" and the acceptance criterion says "RuleTester valid/invalid cases cover all three import shapes." The test file at `packages/eslint-plugin/tests/rules/no-bundled-readfilesync.test.ts` covers the named and member-shape cases (`REQ-040` and `REQ-043` invalid fixtures) but has **no** fixture for an aliased import (`import { readFileSync as rfs } from "node:fs"; rfs(new URL(..., import.meta.url))`). Moreover, the rule implementation in `packages/eslint-plugin/src/rules/no-bundled-readfilesync.ts:77-82` only checks `node.callee.name === "readFileSync"`, so an alias like `rfs(...)` would currently **not** be matched. This is a latent gap both in coverage and in behaviour. Consider either (a) documenting that aliased imports are out of scope (and updating the SPEC), or (b) adding import-tracking via the scope manager so aliases are resolved.

- Files: `packages/eslint-plugin/src/rules/no-bundled-readfilesync.ts:76-82`, `packages/eslint-plugin/tests/rules/no-bundled-readfilesync.test.ts`

### S3 — `enforce-repository-access` does filename path matching inside the rule body

REQ-013 says: "Rules shall not hardcode absolute or package-relative file paths in their logic; path scoping shall be done via flat-config `files` globs in `eslint.config.mjs`." The implementation at `packages/eslint-plugin/src/rules/enforce-repository-access.ts:42-53` has `filename.includes("/repositories/")`, `filename.includes("/tests/")`, `/\.test\.tsx?$/.test(filename)`, and uses `filename.includes("/packages/api/")` to pick the "expected" repo path for the error message.

The flat-config at `eslint.config.mjs:172-182` already scopes the rule properly with `files` + `ignores`, so the filename checks are **defensive duplication**. REQ-013 is enforced by review only (no automated test), and a strict reading would flag this. Two options:
1. Remove the in-rule filename guards entirely and rely on flat-config scoping (simplest, best aligned with REQ-013).
2. Keep the `expected` computation based on filename for a better error message, but drop the `repositories/`/`tests/` early-return since flat-config already handles exclusion.

The safest change is option 2 — delete lines 43-49 and keep only the `filename.includes("/packages/api/")` branch for message selection. (Alternative: pass the correct target as a rule option from flat config.)

- File: `packages/eslint-plugin/src/rules/enforce-repository-access.ts:42-49`

### S4 — Package pinning invariant does not catch `>=`, `<`, `>`, or `*` ranges

`tools/invariants/package-json-pinning.ts:15-19` only flags versions starting with `^` or `~`. REQ-081 is written narrowly ("starting with `^` or `~`"), so the current implementation is technically compliant. However, the existing `packages/eslint-plugin/package.json` peer dependency `"eslint": ">=9.0.0"` silently passes the check even though it is exactly the kind of loose range that the AI-SDK-pinning learning was designed to prevent. Consider tightening `isPinned` to also reject `>`, `>=`, `<`, `<=`, `*`, and `x` ranges, and pinning the peer dep explicitly.

- Files: `tools/invariants/package-json-pinning.ts:15-19`, `packages/eslint-plugin/package.json` (peerDependencies)

### S5 — `no-restricted-imports` blocks ship at `"warn"` alongside custom rules

REQ-014 reads "Every custom rule added to `eslint.config.mjs` shall start at severity `warn`". The repo has opted to also put the Layer 1 `no-restricted-imports` blocks at `"warn"` (`eslint.config.mjs:64, 91, 118`). This is not a violation — REQ-014 speaks to "custom rules" — but REQ-020/021/022/023 acceptance criteria all say `pnpm lint` should "emit" a diagnostic, and warn satisfies that. Worth noting as a conscious choice so reviewers of future promotion PRs know what to flip.

No action required; documentation suggestion.

### S6 — `collector-return-shape` narrows by function name prefix (`collect*`)

The rule checks `node.id.name.startsWith("collect")` (see `packages/eslint-plugin/src/rules/collector-return-shape.ts:16-18`) so helper exports in a collector file are skipped. This is a reasonable narrowing and is documented in the rule's own source comment, but it is **not** described in the SPEC (REQ-060 says "an exported function declared in `packages/pipeline/src/collectors/**`"). Consider documenting this narrowing in `packages/eslint-plugin/docs/rules/collector-return-shape.md` and/or adding a note to the SPEC clarifying that helper exports are intentionally out of scope.

- File: `packages/eslint-plugin/src/rules/collector-return-shape.ts:11-18`

### S7 — `@newsletter/shared/redis` re-export is a one-line file

`packages/shared/src/redis.ts` is a single `export { createRedisConnection } from "./db/redis.js";`. This is fine, but if the intent of the refactor was to fully separate the redis subpath from the db subpath, the underlying source file should also move to `packages/shared/src/redis/index.ts` (or similar) so that all redis-related code is physically outside the `db/` directory. Today, the authoritative source still lives at `packages/shared/src/db/redis.ts`, which is confusing if a future reader jumps to definition. Low priority.

- File: `packages/shared/src/redis.ts`

## SPEC traceability

### Package scaffolding (REQ-001…005)
- REQ-001: covered — `packages/eslint-plugin/package.json` exists; root `eslint.config.mjs` imports it.
- REQ-002: covered — `packages/eslint-plugin/src/index.ts:39-45` exposes `meta.name`, `meta.version`, and `rules`; `meta.test.ts` asserts it.
- REQ-003: covered — `tsup.config.ts` present, `dist/` built, lint passes.
- REQ-004: covered — spot-check: injecting `import { Hono } from "hono";` at the top of `packages/api/src/index.ts` produces `newsletter/dotenv-bootstrap` warning (verified live).
- REQ-005: covered — 6 test files under `packages/eslint-plugin/tests/` (meta + 5 rules), `pnpm --filter @newsletter/eslint-plugin test:unit` passes.

### Rule authoring conventions (REQ-010…014)
- REQ-010: covered — `tests/meta.test.ts:28-43` asserts `meta.type`, `meta.docs.description`, `meta.docs.url`, and `meta.messages` for every rule.
- REQ-011: covered — same test asserts `fs.existsSync(docsPath)`.
- REQ-012: covered — every rule has a matching `tests/rules/<name>.test.ts` with both `valid` and `invalid` fixtures.
- REQ-013: covered with **caveat** (see S3 above) — flat-config scoping is primary, but `enforce-repository-access` has secondary filename checks.
- REQ-014: covered — every `newsletter/*` entry in `eslint.config.mjs` is `"warn"`.

### Layer 1 boundary rules (REQ-020…023)
- REQ-020: covered — `eslint.config.mjs:67-76` patterns `["hono", "hono/*"]` + `["express", "fastify"]` with HTTP-framework message. Covers EDGE-002 (hono subpath).
- REQ-021: covered — `eslint.config.mjs:77-83` with "Pipeline cannot depend on @newsletter/api" message.
- REQ-022: covered — `eslint.config.mjs:89-113` blocks `drizzle-orm`, `@newsletter/shared/db`, and `@newsletter/shared/db/*` in `packages/web/**`.
- REQ-023: covered — `eslint.config.mjs:115-136` restricts route handlers.

### newsletter/dotenv-bootstrap (REQ-030…032)
- REQ-030: covered — `tests/rules/dotenv-bootstrap.test.ts` has multiple invalid cases + a valid case with exact bootstrap.
- REQ-031: covered — config scoped to `packages/api/src/index.ts` and `packages/pipeline/src/index.ts` at `eslint.config.mjs:141`.
- REQ-032: covered — `wrongPath` fixture on `./.env`.
- EDGE-001 (CJS require): covered as an invalid case.

### newsletter/no-bundled-readfilesync (REQ-040…043)
- REQ-040 / REQ-041: covered — invalid fixtures for `new URL(..., import.meta.url)` and `__dirname` template literal.
- REQ-042: **partial** — named and member-shape covered, aliased shape NOT covered (see S2).
- REQ-043: covered — scoped to `packages/pipeline/src/**/*.ts` and `packages/api/src/**/*.ts` at `eslint.config.mjs:151`.
- EDGE-004 (dev script disable comment): implicitly covered via a "variable argument is allowed" valid fixture, but no explicit test with an `eslint-disable-next-line` comment. Minor gap.

### newsletter/enforce-repository-access (REQ-050…053)
- REQ-050: covered (with documented type-only deviation at spec.md:65). Test fixtures cover mixed type/value specifiers, side-effect-only imports, and subpath imports.
- REQ-051: covered.
- REQ-052: covered — config scoped and `ignores` excludes `**/repositories/**` and tests.
- REQ-053: covered — invalid fixture asserts `expected` contains `packages/api/src/repositories/` or `packages/pipeline/src/repositories/`.
- EDGE-003: covered via `apiTestFile` valid fixture.
- EDGE-006: not directly tested (would need a fixture lint run), but follows from the `files`/`ignores` partitioning.

### newsletter/collector-return-shape (REQ-060…062)
- REQ-060: covered — type-aware RuleTester with both valid and invalid cases.
- REQ-061: covered — `ESLintUtils.getParserServices(context)` + `services.getTypeAtLocation` used at `packages/eslint-plugin/src/rules/collector-return-shape.ts:61, 70`.
- REQ-062: covered — `eslint.config.mjs:161`.
- EDGE-005 (type alias): explicit valid fixture.
- EDGE-012 (.d.ts bailout): covered via `.d.ts` filename valid fixture plus early-return at source line 59.
- EDGE-015 (`projectService` setup): covered at test file lines 15-25.
- Note: rule narrows to function names starting with `collect*` — see S6.

### newsletter/no-raw-alter-table (REQ-070…071)
- REQ-070: covered — string literal + template literal invalid fixtures.
- REQ-071: covered — `eslint.config.mjs:151` (same block as `no-bundled-readfilesync`).
- EDGE-010: covered via valid fixture with a variable argument.

### Layer 3 invariants script (REQ-080…085)
- REQ-080: covered — `pnpm check:invariants` exits 0 (verified) and integration test at `tools/tests/check-repo-invariants.integration.test.ts` passes.
- REQ-081: covered — `package-json-pinning.ts` + unit test + integration test. Caveat noted in S4 (does not catch `>=` etc.).
- REQ-082: covered with **documented deviation** — flags drift *among* `@ai-sdk/*` providers instead of strict major-match against `ai`. Rationale is inlined at `tools/invariants/ai-sdk-alignment.ts:68-72` and in the learning file footer.
- REQ-083: covered — check + unit tests + `vitest-good` / `vitest-bad` fixtures.
- REQ-084: covered — scan + allowlist marker; unit tests for `docker-good`, `docker-bad`, and `docker-allowlist` fixtures. Source file cleverly sidesteps self-scan via `"docker" + "-compose"` concatenation.
- REQ-085: covered — root `package.json` chains `turbo lint && pnpm check:invariants`. See S1 for the EDGE-014 caveat.

### Documentation (REQ-090…092)
- REQ-090: covered — `packages/eslint-plugin/docs/rules/README.md` has the decision tree + rule index.
- REQ-091: covered — all 4 mechanically-enforceable learnings have `Enforced by:` footers (`bundled-assets-need-import-not-readfilesync.md`, `lock-ai-sdk-versions-explicitly.md`, `exclude-vitest-config-from-tsc-build.md`, `always-load-dotenv-in-package-entrypoint.md`). `.claude/rules/architecture.md` and related root rules have quoted "Enforced by" callouts.
- REQ-092: not verified — review did not inspect the `/extract-learnings` skill file.

### Out of scope
- Verified that none of the shipped rules attempt auto-fix, variable tracking, or publishing. ✓

## Verifications

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm typecheck` | **PASS** | 6/6 packages clean (FULL TURBO cache hit) |
| `pnpm lint` | **PASS** | 5/5 packages clean + `✓ All repo invariants pass.` |
| `pnpm test:unit` | **PASS** | 55 (eslint-plugin) + 42 (api) + 6 (web) + 178 (pipeline) = **281 unit tests** + 13 tools tests |
| `pnpm check:invariants` | **PASS** | `✓ All repo invariants pass.` |
| Spot check: dotenv-bootstrap fires | **PASS** | Injected `import { Hono } from "hono";` at top of `packages/api/src/index.ts` → rule reported `missingBootstrap` warning |

## Scope & quality notes

- **Code quality rules compliance:** No `any`, no `@ts-ignore`, no `as unknown as X` casts found. The `collector-return-shape` rule uses narrow structural casts `type as { symbol?: ts.Symbol }` with inline comments explaining the need (ts-eslint's types expose these as non-optional). These are not prohibited by `.claude/rules/code-quality.md`.
- **Explicit return types:** exported functions in the plugin and invariants modules declare explicit return types.
- **No premature abstractions:** the `createRule` helper at `packages/eslint-plugin/src/utils/create-rule.ts` is the only shared util, and it is used by every rule.
- **Phase 4 refactor:** zero-behavior-change extract + inject pattern followed; all tests stayed green; no importers of `createRedisConnection` were left pointing at `@newsletter/shared/db`.
- **Package boundaries:** the refactor routes every runtime DB import through `**/repositories/**`, which is exactly what the new `enforce-repository-access` rule requires. This is what makes the rule ship clean.

## Recommendation

Approve and merge after optionally addressing **S1** (cheap, correctness-adjacent) and **S2** (either fix the rule or explicitly de-scope aliased imports in SPEC). The remaining suggestions can be follow-up tickets.
