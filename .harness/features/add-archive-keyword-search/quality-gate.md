# Quality Gate Report — add-archive-keyword-search

**Stage:** post-tdd
**Run at:** 2026-05-07
**Verdict:** <!-- QG:VERDICT:PASS -->

## Summary Table

| Check | Name | Result |
|-------|------|--------|
| 1 | Type checker | PASS |
| 2 | Linter | PASS |
| 3 | Unit + Seam Tests | PASS (baseline failures only) |
| 4 | Coverage / test-count parity | PASS |
| 5 | Scope Compliance | PASS |
| 6 | Plan Compliance | PASS |
| 7 | Ignore Comment Audit | PASS |
| 8 | Spec-Driven Verification | PASS (see verification/proof-report.md) |
| 9 | Exploratory QA | NOT_RUN (covered by Step 1 functional verification) |

---

## Check 1: Type Checker — PASS <!-- QG:CHECK:1:PASS -->
`pnpm typecheck` → 7/7 tasks pass, 0 errors. Evidence: `qg-typecheck.log`.

## Check 2: Linter — PASS <!-- QG:CHECK:2:PASS -->
`pnpm lint` → 0 errors, 6 pre-existing warnings (matches baseline.json). Evidence: `qg-lint.log`.

## Check 3: Unit + Seam Tests — PASS <!-- QG:CHECK:3:PASS -->

**Unit (`pnpm test:unit`):** all 7 tasks pass — 30 api / 42 pipeline / 40 web / 6 shared / 3 eslint files; 1229 tests total. No regressions vs baseline. Evidence: `qg-test-unit.log`.

**E2E (`pnpm test:e2e`):** baseline pre-existing failures only — no new regressions. Evidence: `qg-test-e2e-fresh.log`, `qg-pipeline-e2e-direct.log`, `qg-web-e2e.log`.

Pre-existing failures (verified by running on bare baseline commit `cd0fda9` after `git stash`):

| Package | Test file | Failures | Status |
|---------|-----------|----------|--------|
| api | `tests/e2e/runs.e2e.test.ts` | 2 | Documented baseline (baseline.json) |
| pipeline | `tests/e2e/seam/workers/collection.e2e.test.ts` | 4 (`upsertItems` undefined — collector bootstrap issue) | Pre-existing on `cd0fda9` (not in baseline.json but verified) |
| web | `tests/e2e/archive.spec.ts` | 2 (test setup waits for `/run` flow) | Pre-existing on `cd0fda9` |

All other suites pass cleanly, including the new `archives-search.e2e.test.ts` (10 tests), `archives-search-migration.e2e.test.ts` (8 tests), `run-archives-repo-search-text.e2e.test.ts` (2 tests), and `archive-search.spec.ts` (3 Playwright tests). The 2 archives-search e2e tests that briefly failed in a polluted DB run were caused by the perf bench's 1,000 synthetic archives crowding the `limit=50` window; after `bench:search -- --teardown` they pass. Bench script auto-cleans on subsequent runs.

## Check 4: Coverage / Test Count Parity — PASS <!-- QG:CHECK:4:PASS -->

| Package | Baseline tests | Current tests | Δ |
|---------|---------------:|--------------:|---|
| pipeline (unit) | 489 | 490 | +1 |
| web (unit) | 261 | 319 | +58 |
| api (unit) | (n/a) | 342 | — |
| shared (unit) | (n/a) | 48 | — |

No package regressed below baseline.

## Check 5: Scope Compliance — PASS <!-- QG:CHECK:5:PASS -->

All modified/added files map to phases 1–7. New surfaces: search route + repo extension, FTS migration, archive-search-text service, search/date-range UI components, ledger-listing wiring, perf bench. Sole non-feature change: `packages/web/test-results/.last-run.json` (Playwright auto-generated artifact).

## Check 6: Plan Compliance — PASS <!-- QG:CHECK:6:PASS -->

Each phase deliverable verified:
- P1 unaccent migration: `0014_lazy_silver_surfer.sql` present
- P2 repo `searchArchives`: present in `packages/api/src/repositories/run-archives.ts` and pipeline mirror
- P3 search route: `packages/api/src/routes/archives-search.ts`
- P4 archive-search-text service: `packages/shared/src/services/archive-search-text.ts`
- P5 SearchBar / DateRangeChip / DateRangePopover / ResultMeta / EmptyResults: all present
- P6 ArchiveListingPage wiring: present
- P7 perf bench: `packages/api/scripts/seed-search-perf.ts` + `bench:search` script

## Check 7: Ignore Comment Audit — PASS <!-- QG:CHECK:7:PASS -->

Zero `@ts-ignore` / `@ts-expect-error` / `eslint-disable` introduced by this feature. Pre-existing suppressions in unrelated files (pipeline workers, ArchiveShareRow) are unchanged.

## Check 8: Spec-Driven Verification — PASS <!-- QG:CHECK:8:PASS -->

All 12 verification scenarios pass; see `verification/proof-report.md`. Perf gate: P95 = **14.37 ms** (limit 200 ms).

## Check 9 — NOT_RUN

Step 1 (functional verification) covered the full UI flow via Playwright. No additional exploratory probing executed.

---

## Verdict

<!-- QG:VERDICT:PASS -->

All gates pass. No new regressions introduced. The 2 baseline failures in `runs.e2e.test.ts` and the additional 4 pipeline-seam + 2 web-archive failures were all confirmed pre-existing on the base commit `cd0fda9` and are not caused by this feature.
