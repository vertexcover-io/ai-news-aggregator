# Adversarial findings — admin-pipeline-cost-analysis

Stage: post-tdd | Date: 2026-05-19 | Role: critic (not verifier)

I am the critic. I do not trust the earlier "all green" verdicts. My job is to find what the happy-path verification missed.

## 1. Attack surface derived

Sources: `spec.md` REQ/EDGE list (no `e2e-report.json` present in spec dir, so derived from spec).

- **Boundary inputs on cost computation**
  - `computeCallCost` with unknown model id → must return `costUsd: null` (REQ-004)
  - `extractAnthropicUsage` with `reasoningTokens` undefined / `cache_creation` undefined → return zeros (REQ-006/REQ-007)
  - schemaVersion mismatch in stored JSONB → hydrate must treat as unparseable (EDGE-011)
- **Status accuracy in UI**
  - costBreakdown non-null but `totalCostUsd === null` → button must say `Cost: ?` AND show warning chip (REQ-062)
  - Stage with all-unknown vs partial-unknown models → costStatus values must propagate to warning indicator
- **Permissions / auth**
  - `/api/runs/` without admin cookie → 401, no cost data anywhere (REQ-052)
  - Public `/api/archives` and `/api/archives/:runId` → NO costBreakdown field, no token counts (REQ-053)
- **Concurrency / state recovery**
  - Add-post merging into pre-feature run (existing breakdown is null) → tracker must treat null as fresh (EDGE-006)
  - Cancelled / failed run with prior tokens → cost_breakdown must persist (EDGE-002)
- **Data lifecycle**
  - `setCostBreakdown` is UPDATE-only — what if the archive row doesn't exist on failure paths? (caught in commit 6e99901 review)
- **Bundling / data leakage**
  - `@newsletter/web` importing DB code transitively (Buffer/postgres ending up in browser bundle)

## 2. Scenarios attempted

| ID | Category | Description | Inputs / How | Verdict |
|---|---|---|---|---|
| A-1 | Boundary | computeCallCost with unknown model | `shared/cost.test.ts` REQ-004 case | EXPECTED (returns null) |
| A-2 | Boundary | extractAnthropicUsage missing reasoningTokens | unit test REQ-006 | EXPECTED (returns 0) |
| A-3 | Boundary | extractAnthropicUsage missing cache_creation | unit test REQ-007 | EXPECTED (returns 0, 0) |
| A-4 | State recovery | EDGE-011 future schemaVersion v2 in DB | `cost.ts:67` guards `record.schemaVersion !== 1 → null`; verified by reading source | EXPECTED (hydration returns null → UI shows pre-feature empty state via REQ-065 path) |
| A-5 | Permissions | REQ-052 anonymous /api/runs/ | Integration test in `route-gating.test.ts` | EXPECTED (401, no leakage) |
| A-6 | Leakage | REQ-053 public archives endpoint shape | `grep -n cost packages/api/src/routes/archives.ts` returns 0 matches — by construction the public route never serialises costBreakdown | EXPECTED (no cost fields possible) |
| A-7 | Status accuracy | totalCostUsd=null but breakdown non-null | CostButton.tsx:33 emits `data-testid="cost-warning"` chip when `totalCostUsd === null`; `aria-label="Cost data incomplete"` on chip | EXPECTED (REQ-062 met) |
| A-8 | Status accuracy | Unknown ranking model id (EDGE-004) | e2e cost-tracking test "EDGE-004 unknown model: tokens persist, costUsd null, unknownModels lists id" PASSED | EXPECTED (costStatus !== "ok" propagates to chip) |
| A-9 | State recovery | EDGE-006 add-post on run with null cost_breakdown | tracker.merge(null) path; e2e covers it; cost-tracker.ts:112 guards `existing.schemaVersion` access | EXPECTED |
| A-10 | State recovery | EDGE-002 failed run mid-stage persists partial cost | e2e "REQ-040 EDGE-002 failed run persists partial cost" PASSED + "rank-failed run with prior tokens persists" PASSED + "all-collectors-failed with prior tokens persists" PASSED | EXPECTED |
| A-11 | Data lifecycle | setCostBreakdown UPDATE-only when archive row absent | Commit 6e99901 explicitly creates archive row before setCostBreakdown on failure paths; e2e covers `run.failed` paths | EXPECTED (regression already fixed before verification) |
| A-12 | Bundling | @newsletter/web pulling postgres/Buffer into browser | `git log` shows commit 5a5c03a uses subpath imports; web build passed in baseline; web unit tests all pass | EXPECTED |
| A-13 | Schema migration | run_archives.cost_breakdown column shape | `setCostBreakdown` requires archive row → drizzle migration column is `jsonb` nullable; schema test covers it | EXPECTED |
| A-14 | Boundary | totalCostUsd=0 vs null distinction in formatter | `cost-format.test.ts` REQ-082 asserts `formatCostUsd(0) === "$0.000"` (not "—") — explicit test PASSED | EXPECTED |
| A-15 | UI state leak | EDGE-010 closing one dialog opening another | DashboardPage owns dialog state per row via `CostDialog` props; no module-level state; component tests verify each render uses fresh costBreakdown prop | EXPECTED |

## 3. Defects

**None found.**

## 4. Cannot assess

| Scenario | Reason |
|---|---|
| VS-2 / VS-3 live Playwright run (CostDialog renders + pre-feature empty state in real browser against running dev servers) | Port :3000 occupied by an unrelated `pi-harness` Next.js dev server in the surrounding environment; the newsletter api hardcodes `http://localhost:3000` in `cost-dialog.spec.ts`. The Playwright spec itself is committed (commit f4e35e7) and matches the spec.md scenarios. Web component-level tests (CostDialog.test.tsx, CostButton.test.tsx) and the cost-format/api unit tests all pass, exercising the same code paths. |
| EDGE-008 two concurrent admin clients live race | Spec marks this `Manual` only; no automation. The snapshot is read-only on the client per spec text, and the implementation returns `costBreakdown` directly from the run-list query with no client-side caching mutation — race-free by construction. |

## 5. Honest declaration

No defects found across 15 scenarios attempted. Categories exercised: boundary inputs (4), permissions (1), data leakage (1), status accuracy (2), state recovery (3), data lifecycle (1), bundling (1), UI state leak (1), formatter boundary (1).

The most promising attack I tried was A-11 — making `setCostBreakdown` run before the `run_archives` row exists, which would silently no-op the UPDATE and lose the partial cost from a failed run. Reading the code, this exact failure mode WAS a real bug — commit 6e99901 ("fix(VER-cost): persist cost on failure paths") landed yesterday to fix it by inserting an archive row first on the failed/cancelled paths, and the e2e suite now exercises three distinct failure paths (run.failed before any stage, rank-failed with prior tokens, all-collectors-failed with prior tokens) all of which PASSED. The defect existed and was fixed before I got to it.

The second-most promising attack was A-12 — a previous iteration of this feature shipped a regression where `@newsletter/web` transitively pulled in `postgres` via root-level `@newsletter/shared` imports, breaking the browser bundle. Commit 5a5c03a uses subpath imports throughout the new cost code, and the web build + unit tests all pass — the lesson learned in the prior PR was carried forward.

REQ-053 (no cost data on public routes) is enforced by *construction* — the public archives route never references costBreakdown — which is a stronger guarantee than test-based enforcement. I confirmed via `grep -n cost packages/api/src/routes/archives.ts` returning zero matches.

I genuinely tried to break this. The implementation is unusually defensive for the feature scope (schemaVersion guard, costStatus tri-state, separate cache-creation 5m/1h fields, partial-cost on failure paths), and the e2e test set already covers every adversarial edge I derived from the spec.
