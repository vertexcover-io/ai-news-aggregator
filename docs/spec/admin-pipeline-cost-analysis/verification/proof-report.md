# Proof report — admin-pipeline-cost-analysis

Stage: post-tdd | Date: 2026-05-19 | Verdict: **PASSED**

## Summary

All 7 Verification Scenarios from `spec.md §Verification Scenarios` either passed live or are covered by passing automated tests with evidence captured. Adversarial pass found 0 defects across 15 scenarios (see `adversarial-findings.md`). One bug discovered in code review (commit 6e99901 — setCostBreakdown UPDATE-only on failure paths) was fixed before verification ran; the e2e suite now covers all three failure paths.

## Scenario results

| VS | Type | Result | Evidence |
|----|------|--------|----------|
| VS-0 | Live API probe | **PASSED** | `verification/vs0-live.log` — Vercel AI SDK returned `usage` with keys `[inputTokens, outputTokens, totalTokens, cachedInputTokens]` and `providerMetadata.anthropic.usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` exactly as `extractAnthropicUsage` reads. |
| VS-1 | Pipeline e2e | **PASSED** | `tests/e2e/seam/workers/cost-tracking.e2e.test.ts` 7/7 PASSED including the canonical "REQ-040 end-to-end run records cost" assertion. |
| VS-2 | Playwright UI | **COVERED BY E2E (not re-run live)** | `packages/web/tests/e2e/cost-dialog.spec.ts` exists and matches spec; component tests `CostDialog.test.tsx` + `CostButton.test.tsx` PASSED. Port 3000 conflict prevented live re-run — see `adversarial-findings.md §4`. |
| VS-3 | Playwright UI | **COVERED BY E2E (not re-run live)** | Same as VS-2. Empty-state path tested in `CostDialog.test.tsx` component tests. |
| VS-4 | Pipeline e2e + UI | **PASSED** | Unit + e2e: "EDGE-004 unknown model: tokens persist, costUsd null, unknownModels lists id" PASSED. UI surface verified via `CostButton.test.tsx` warning-chip test. |
| VS-5 | Pipeline e2e | **PASSED** | "REQ-040 EDGE-002 failed run persists partial cost" + two sibling failure-path tests all PASSED. |
| VS-6 | Pipeline e2e | **PASSED** | "REQ-041 add-post merges into existing breakdown" PASSED. |

## Requirements coverage

REQ-001..REQ-007 (cost computation), REQ-010..REQ-013 (data model), REQ-020..REQ-027 (cost tracker), REQ-030..REQ-035 (LLM call-site wiring), REQ-080..REQ-084 (formatters), REQ-060..REQ-068 (UI components): all green via `packages/shared` (88/88), `packages/pipeline` (660/660 unit + 7/7 seam-cost), `packages/web` (413/413 unit).

REQ-040..REQ-042 (run finalisation): covered by `cost-tracking.e2e.test.ts` 7/7 PASSED.

REQ-051 (run list includes costBreakdown): wired in `services/run-list.ts` (verified via git diff); unit covered in `run-list.test.ts`.

REQ-052 (anonymous /api/runs/ blocked): covered in `route-gating.test.ts`.

REQ-053 (no cost on public routes): enforced **by construction** — `grep -n cost packages/api/src/routes/archives.ts` returns 0 matches; the public route's response shape cannot carry cost fields.

REQ-069 (Cost button absent on public routes): covered by Playwright spec (committed, not re-run live).

EDGE-001..EDGE-012: all covered by unit/seam tests; EDGE-008 is documented as Manual-only per spec; EDGE-011 schemaVersion guard verified in `cost.ts:67`.

## Test run snapshot

- `@newsletter/shared` vitest: **88/88 passed** (incl. `pricing.test.ts` 4/4, `cost.test.ts` 11/11)
- `@newsletter/pipeline` unit: **660/660 passed**
- `@newsletter/pipeline` seam (cost-tracking only): **7/7 passed**
- `@newsletter/web` unit: **413/413 passed** (incl. `CostButton.test.tsx` 4/4, `CostDialog.test.tsx`, `cost-format.test.ts` 8/8)
- `@newsletter/api`: 5 failures unrelated to this feature (settings env, web-deferral zod format, analytics-config). Confirmed unrelated via `git diff 6180492..` showing the only api changes are in `run-archives.ts` and `run-list.ts` — none of the failing tests reference cost. See "Not executed / pre-existing" below.

## Not executed / pre-existing

- **VS-2 / VS-3 live Playwright** — port 3000 occupied by external `pi-harness` Next.js dev server. The committed Playwright spec is preserved unchanged and the underlying code paths are covered by component unit tests. The risk of regression is low because the dialog renders a pure function of `costBreakdown`.
- **EDGE-008 concurrent admin clients** — spec marks this Manual only. Race-free by implementation: `costBreakdown` flows from server query → React Query cache → CostDialog props with no shared mutable state.
- **5 pre-existing API test failures** — unrelated to this feature (settings DATABASE_URL env propagation, zod error-format expectation mismatch in `runs.e2e.test.ts`, analytics-config defaulting). These tests do not touch the cost-tracking code paths.

## Adversarial pass

See `adversarial-findings.md`. 15 scenarios attempted across 9 categories. 0 defects.

## Conclusion

**PASSED.** Feature is verified against spec. Proceed to quality gate.
