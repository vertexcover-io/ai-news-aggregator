# SPEC — Tech Debt Fix Pass (2026-06-04)

**Inputs:** `.harness/tech-debt/2026-06-04/findings.json` (source of truth — fix list MUST be derived from it, never from prose), issues #247–#251, `design.md`, `library-probe.md`.

## Requirements (EARS)

- **REQ-1 (Dependency, #247):** WHEN the dependency work stream completes, the system SHALL have the exact pins from `library-probe.md` applied (drizzle-orm 0.45.2 + drizzle-kit 0.31.10, hono 4.12.23, @hono/node-server 1.19.14, react-router-dom 7.16.0, vite 8.0.16, bullmq 5.78.0, @tanstack/react-query 5.101.0, root pnpm.overrides ws 8.21.0 + engine.io 6.6.8), `react-email` removed from api+pipeline deps, and the `await import("drizzle-orm")` in `packages/api/src/repositories/subscribers.ts` replaced with a static import. vitest 4.1.8 SHALL be attempted; IF migration cost is non-trivial THEN it stays 3.2.1 with the finding dispositioned `issue`+reason.
- **REQ-2 (Code smell, #251):** The system SHALL remove every `auto_fixable: true` `unused-export`/`unused-type` finding (drop the `export` keyword or barrel line; keep declarations that are used internally). Unused files SHALL be deleted ONLY when verified dead (not referenced by package.json scripts, deploy tooling, docs-mandated operator flows, or dynamic import). Kept files → disposition `dropped` with reason.
- **REQ-3 (Architecture, #249):** `run-process.ts` SHALL be decomposed into service modules (failed-archive writer, digest derivation, finalize/notify/schedule) leaving `handleRunProcessJob` a thin sequencer; `admin-eval.ts` route SHALL delegate ranking-construction + run-orchestration logic to `packages/api/src/services/`. All existing tests SHALL pass unmodified except for import-path updates.
- **REQ-4 (Complexity, #248):** The top CC≥16 functions listed in design WS-4 SHALL be refactored behavior-preserving below CC 16 where achievable without API changes; each touched function's existing tests SHALL pass unmodified (except import paths).
- **REQ-5 (Duplication, #250):** The design WS-5 clone groups SHALL be consolidated via extraction; 804 test-only clone groups SHALL be suppressed via `.claude/harness/tech-debt-ignore.md` per-file rules.
- **REQ-6 (Handoff contract):** BEFORE commit/PR, `.harness/tech-debt/2026-06-04/fix-manifest.json` SHALL assign every one of the 1,085 finding ids exactly one terminal disposition (`fixed`/`issue`/`suppressed`/`dropped`+non-empty reason); zero `auto_fixable` findings dropped without reason; each PR body SHALL carry the reconciliation table for its issue.
- **REQ-7 (No regressions):** EVERY work stream SHALL leave `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` green, and the e2e suites green for touched packages. No public behavior change.
- **REQ-8 (PR mapping):** Each work stream SHALL land as its own branch + PR referencing its issue (#247–#251); work streams SHALL NOT touch files owned by another stream (per design Constraints) so branches cherry-pick cleanly from the integration branch.

## Edge cases
- Unused export that a test file imports → not actually unused for tests; keep export, disposition `dropped` (reason: test-consumed) unless the test is itself dead.
- `is_re_export` entries in `packages/shared` barrels → check both `package.json#exports` subpaths and external consumers before removal.
- drizzle 0.42→0.45 may change query-builder typings used by repositories → fix call sites, never loosen types.
- vitest 4: `--project` flag and workspace config semantics may change → migration limited to config files; if source-level changes are needed, trigger the fallback.
- Files under `scripts/` flagged unused but referenced in docs (e.g. OAuth setup flows in CLAUDE.md) → keep.

## Verification Scenarios
- **VS-1 (gates):** `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` green at every phase boundary; package-scoped e2e (`pnpm --filter <pkg> test:e2e`) green for touched packages at stream end.
- **VS-2 (app smoke, UI):** With local infra up, web app serves: `/` (public listing renders), `/admin/login` → login with ADMIN_PASSWORD → `/admin` dashboard shows run rows, `/admin/eval` renders, one `/archive/:runId` renders. Playwright MCP screenshots per page.
- **VS-3 (pipeline smoke):** pipeline worker boots clean (no import errors after refactor/dead-code removal): start worker process, observe ready log, no crash within 10s.
- **VS-4 (manifest reconciliation):** `fix-manifest.json` validates: counts sum to 1,085; no auto_fixable finding `dropped` without reason; every `fixed` id corresponds to a real diff hunk.
- **VS-5 (dependency CVE check):** after WS-1, `pnpm audit --prod` shows no Critical advisories for direct deps (hono, drizzle-orm clean).
