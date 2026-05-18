# SPEC — Admin Pipeline Cost Analysis

**Date:** 2026-05-18
**Design doc:** `docs/plans/2026-05-18-admin-pipeline-cost-analysis-design.md`
**Linear:** (not yet ticketed)

## Goal

Capture LLM API spend per pipeline run (web listing, web extraction, ranking, recap), persist a per-stage breakdown to `run_archives`, and surface it in the admin UI both as a section on the per-run review page and as a dialog opened from the dashboard recent-runs table.

## Requirements (EARS)

- **R1 (capture):** WHEN a pipeline run executes any LLM call via Vercel AI SDK `generateObject` in web.ts / rank.ts / recap.ts, THE system SHALL record `{ stage, modelId, promptTokens, completionTokens }` into a per-run `RunCostAccumulator`.
- **R2 (resilience):** WHEN `result.usage` is missing or malformed on an SDK response, THE accumulator SHALL record zero tokens for that call AND increment `stages[stage].missingUsageCallCount` AND log a warning — it SHALL NOT throw.
- **R3 (compute):** WHEN snapshotting cost, THE system SHALL compute USD cost as `(inputTokens / 1_000_000) * inputPerMTok + (outputTokens / 1_000_000) * outputPerMTok` using `CLAUDE_PRICING` from `@newsletter/shared/pricing/claude.ts`. Unknown model id ⇒ usdCost = 0, increment `unknownModelCallCount`, log warning.
- **R4 (persist on terminal status):** WHEN a run reaches terminal status (completed, failed, OR cancelled), THE pipeline SHALL flush `accumulator.snapshot()` into `run_archives.cost_breakdown` for that run. Flush executes in a `finally`-equivalent path so failures and cancellations still persist partial costs.
- **R5 (schema):** THE `run_archives` table SHALL have a nullable jsonb column `cost_breakdown` typed as `RunCostBreakdown | null`.
- **R6 (API — full archive):** `GET /api/archives/:runId` (public) SHALL include `costBreakdown` in its response shape.
- **R7 (API — focused):** `GET /api/admin/archives/:runId/cost` (admin, gated) SHALL return `{ runId: string; costBreakdown: RunCostBreakdown | null }`.
- **R8 (UI — per-run section):** `/admin/review/:runId` SHALL render a `CostBreakdownCard` showing the four stage rows (label, callCount, inputTokens, outputTokens, usdCost), a total row, and the pricing `lastVerified` date.
- **R9 (UI — dashboard dialog):** Each row in the dashboard recent-runs table SHALL include a small `$` icon button. Clicking opens a dialog rendering the same `CostBreakdownCard` for that run, with data fetched on dialog open via `GET /api/admin/archives/:runId/cost`.
- **R10 (UI — backwards compat):** WHEN `costBreakdown === null`, the card SHALL render an empty state ("No cost data captured for this run").
- **R11 (UI — warnings):** WHEN any stage has `missingUsageCallCount > 0` OR `unknownModelCallCount > 0`, the card SHALL surface a small warning badge on that stage row.

## Out of scope

- Public `/archive/:runId` cost visibility.
- Daily/weekly trend charts (`/admin/costs` page).
- Cost regression alerting (Slack).
- Editable pricing admin UI (constants live in code).
- Prompt caching cost categories (not currently used by pipeline; types accommodate future extension).

## Verification Scenarios

### VS-0a: Pricing constants match Claude docs

Read `@newsletter/shared/pricing/claude.ts`. Assert `CLAUDE_PRICING["claude-haiku-4-5-20251001"]` equals `{ inputPerMTok: 1, outputPerMTok: 5, lastVerified: "2026-05-18", source: "https://platform.claude.com/docs/en/about-claude/pricing" }`.

### VS-0b: `computeUsdCost` math is correct

`computeUsdCost("claude-haiku-4-5-20251001", 1000, 500)` returns `{ usdCost: 0.0035, unknownModel: false }`. `computeUsdCost("future-model-xyz", 1000, 500)` returns `{ usdCost: 0, unknownModel: true }`.

### VS-1: Accumulator records and snapshots correctly

Create accumulator, call `record("rank", { usage: { promptTokens: 1000, completionTokens: 500 }, response: { modelId: "claude-haiku-4-5-20251001" }}, "claude-haiku-4-5-20251001")` twice and `record("recap", { usage: { promptTokens: 2000, completionTokens: 1000 } …}, …)` once. `snapshot()` returns:
- `stages.rank` = `{ inputTokens: 2000, outputTokens: 1000, callCount: 2, usdCost: 0.007, model: "claude-haiku-4-5-20251001" }`
- `stages.recap` = `{ inputTokens: 2000, outputTokens: 1000, callCount: 1, usdCost: 0.007, model: "claude-haiku-4-5-20251001" }`
- `totalUsdCost: 0.014`, `totalInputTokens: 4000`, `totalOutputTokens: 2000`

### VS-2: Missing usage handled gracefully

`record("rank", { usage: undefined, response: { modelId: "claude-haiku-4-5-20251001" } }, "claude-haiku-4-5-20251001")` does not throw. Snapshot shows `stages.rank.missingUsageCallCount === 1`, `inputTokens === 0`, `outputTokens === 0`, `usdCost === 0`, `callCount === 1`.

### VS-3: Pipeline integration — happy path

Execute a full pipeline run with mocked `generateObject` returning known token counts for web listing (1 call), web extraction (2 calls), rank (1 call), recap (1 call). After completion, query `run_archives` for that runId — `cost_breakdown` jsonb contains all four stage buckets with expected values and a non-zero total.

### VS-4: Pipeline integration — failure path

Mock `rank` to throw mid-run. Verify `run_archives` row for that run has `status: "failed"` AND `cost_breakdown` populated with web-stage costs (rank and recap missing or zero callCount).

### VS-5: API endpoints return correct shape

`GET /api/archives/:runId` includes `costBreakdown` in response (matches stored value). `GET /api/admin/archives/:runId/cost` returns `{ runId, costBreakdown }`. Unauthenticated request to admin endpoint returns 401.

### VS-6: UI renders correctly (Playwright)

- Visit `/admin/review/:runId` for a run with cost data — card shows 4 stage rows + total + `lastVerified` date.
- Visit `/admin` — recent-runs table rows have `$` button; click → dialog opens with card; correct data displayed.
- Visit `/admin/review/:runId` for an archive with `costBreakdown === null` — card shows "No cost data captured" empty state.
- Run with a stage having `missingUsageCallCount > 0` — warning badge visible on that row.
