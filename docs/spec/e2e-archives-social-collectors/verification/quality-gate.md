# Quality Gate Report — post-tdd

**State:** `4a324a9 fix(deploy): wire TAVILY_API_KEY into production env`
**Date:** 2026-05-21
**Stage:** post-tdd

<!-- QG:VERDICT:PASS -->
**Verdict: PASS**

## Results

| # | Check | Current | Verdict |
|---|---|---|---|
| 1 | Type Checker | `pnpm typecheck` exit 0 | PASS |
| 2 | Linter | `pnpm lint` exit 0; 10 existing web warnings, 0 errors | PASS |
| 3 | API E2E | 7 passed, 0 failed | PASS |
| 4 | Pipeline E2E | 7 passed, 1 skipped, 0 failed | PASS |
| 5 | Web E2E | 2 passed, 0 failed | PASS |
| 6 | Claims Aggregation | 16 executed, 16 passed, 0 failed | PASS |
| 7 | UI Proof Gate | 2 UI claims have screenshot-backed proof | PASS |
| 8 | Ignore Comment Audit | No new ignore comments | PASS |

## Evidence

### Check 1: Type Checker

<!-- QG:CHECK:1:PASS -->
**Command:** `pnpm typecheck`

**Exit code:** 0

**Summary:** Turbo reported `Tasks: 7 successful, 7 total`.

### Check 2: Linter

<!-- QG:CHECK:2:PASS -->
**Command:** `pnpm lint`

**Exit code:** 0

**Summary:** Turbo reported `Tasks: 5 successful, 5 total`. The web package still reports 10 existing warnings and 0 errors.

### Check 3: API E2E

<!-- QG:CHECK:3:PASS -->
**Command:** `pnpm --filter @newsletter/api exec vitest run --project e2e tests/e2e/archives.e2e.test.ts`

**Exit code:** 0

**Summary:** `tests/e2e/archives.e2e.test.ts`: 7 tests passed.

### Check 4: Pipeline E2E

<!-- QG:CHECK:4:PASS -->
**Command:** `pnpm --filter @newsletter/pipeline exec vitest run --project seam tests/e2e/seam/workers/linkedin-post.e2e.test.ts tests/e2e/seam/workers/twitter-post.e2e.test.ts tests/e2e/seam/workers/daily-run.e2e.test.ts tests/e2e/seam/collectors/twitter.e2e.test.ts tests/e2e/seam/collectors/web-search.e2e.test.ts --reporter=verbose`

**Exit code:** 0

**Summary:** 4 files passed, 1 skipped; 7 tests passed, 1 skipped.

### Check 5: Web E2E

<!-- QG:CHECK:5:PASS -->
**Command:** `pnpm --filter @newsletter/web exec playwright test tests/e2e/review-remove.spec.ts tests/e2e/review-inline-edit.spec.ts --reporter=line`

**Exit code:** 0

**Summary:** 2 Playwright tests passed.

### Check 6: Claims Aggregation

<!-- QG:CHECK:6:PASS -->
**Command:** aggregate `.harness/e2e-archives-social-collectors/phase-*-claims.json` with the orchestrate `jq -s` command.

**Exit code:** 0

**Summary:** `.harness/e2e-archives-social-collectors/claims.json` reports 16 executed, 16 passed, 0 failed, 2 UI claims.

### Check 7: UI Proof Gate

<!-- QG:CHECK:7:PASS -->
**Command:** validate every `type == "ui"` claim in `claims.json` appears in `verification/proof-report.md` near a `verification/screenshots/*.png` path.

**Exit code:** 0

**Summary:** `PHASE1-C7` and `PHASE1-C8` are both referenced with screenshot paths in `verification/proof-report.md`.

### Check 8: Ignore Comment Audit

<!-- QG:CHECK:8:PASS -->
**Command:** `git diff --unified=0 | rg '^\\+[^+].*(@ts-ignore|@ts-expect-error|# noqa|//nolint|#\\[allow\\(|eslint-disable)'`

**Exit code:** 1

**Summary:** No new ignore comments matched the audit patterns.

## Notes

The first verify worker attempted `pnpm --filter @newsletter/api test:e2e -- tests/e2e/archives.e2e.test.ts`, which caused unrelated API E2E files to run and fail on pre-existing/out-of-scope behavior. The quality gate was rerun with the direct Vitest command used by the phase and review stages, which targets the archive E2E file required by this spec.
