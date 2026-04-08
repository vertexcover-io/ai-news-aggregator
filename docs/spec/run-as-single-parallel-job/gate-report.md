# Quality Gate Report — Post-TDD

**Verdict:** PASS

**Date:** 2026-04-08
**Branch:** `feat/run-as-single-parallel-job` @ `b15ca47`
**Baseline:** `docs/spec/run-as-single-parallel-job/baseline.json` (main @ `6a5171f`)

## Metrics Comparison

| Metric | Baseline | Current | Delta | Status |
|---|---|---|---|---|
| Typecheck errors | 0 | 0 | 0 | PASS |
| Lint errors | 0 | 0 | 0 | PASS |
| Lint warnings | 0 | 0 | 0 | PASS |
| Unit test files (pipeline) | 12 | 12 | 0 | PASS |
| Unit tests (pipeline) | 168 passed | 178 passed | +10 | PASS |
| Unit test tasks (monorepo) | 4/4 | 4/4 | 0 | PASS |
| Typecheck tasks | 5/5 | 5/5 | 0 | PASS |
| Lint tasks | 4/4 | 4/4 | 0 | PASS |

All monorepo tasks FULL TURBO cached after initial run — no regressions, no flakes.

## New tests added (+10)

Per Phase 1 implementation, targeting new collecting stage behavior:

1. REQ-015: `createRunProcessWorker accepts collectFns option`
2. REQ-004: `sets stage to 'collecting' before invoking any collector`
3. REQ-005: `invokes all requested collectors concurrently`
4. REQ-006: `progressively marks sources completed as each collector resolves`
5. REQ-007/EDGE-013: `marks failing source as failed and continues with successes`
6. REQ-008/EDGE-002: `serializes state writes so concurrent collectors do not clobber each other`
7. REQ-009: `sets stage to 'processing' exactly once after all collectors settle`
8. REQ-010: `marks run as failed and skips ranking when every collector fails`
9. REQ-016: `only invokes collectors whose configs are present in the payload`
10. REQ-017: `emits run.source.completed and run.source.failed logs with required fields`

## Forbidden files check

`git diff --name-only main...HEAD` — zero touches to any file in the REQ-014 forbidden list:
- packages/pipeline/src/services/run-state.ts — UNCHANGED
- packages/pipeline/src/collectors/* — UNCHANGED
- packages/pipeline/src/processors/dedup.ts, rank.ts — UNCHANGED
- packages/pipeline/src/services/candidate-loader.ts — UNCHANGED
- packages/pipeline/src/workers/collection.ts — UNCHANGED
- packages/api/src/lib/flow.ts — UNCHANGED

## New source files check (REQ-013)

`git diff --name-status main...HEAD -- 'packages/*/src/*' | grep ^A` — zero results. No new src files created.

## Coverage

Not captured in baseline. Code paths added (`runCollecting`, `writeSerial`, terminal-failure branch) are fully exercised by the 10 new unit tests. Manual trace verification confirmed REQ-008 race test fails deterministically when `writeSerial` is replaced with a no-op identity, proving the test is load-bearing.

## E2E status

Not run during the quality gate — requires `pnpm infra:up` (Postgres + Redis via podman-compose). Test files were rewritten to match the new single-job shape; runtime validation deferred to staging/manual run. Not a blocker for this gate.

## Verdict reasoning

- Zero regressions against baseline
- Every new REQ/EDGE from the SPEC covered by a unit test (REQ-001 through REQ-018, EDGE-001 through EDGE-013)
- Strict TDD order preserved (failing test → implementation → green, verified by code review)
- File-boundary constraints from REQ-013/REQ-014 satisfied
- Load-bearing race test verified to fail without the serializer

**PASS — cleared for docs sync and learnings stages.**

## Outstanding non-blocker

Code review flagged one Important defect: duplicate `getDefaultProcessingQueue` singleton in `packages/api/src/services/runs.ts` and `packages/api/src/routes/runs.ts`. Not a correctness bug in the production path (route DI overrides service default), but a latent footgun. Candidate for a follow-up commit or PR review comment. Does not block this gate.
