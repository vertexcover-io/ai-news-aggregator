# Admin Pipeline Cost Analysis — Design

**Date:** 2026-05-18
**Status:** Approved scope, pending plan approval
**Spec dir:** `docs/spec/admin-pipeline-cost-analysis/`

## Problem Statement

The admin (Aman/Ritesh) cannot see what each pipeline run costs in API spend. Three LLM call sites — web collector listing/extraction, ranking, recap/digest — accumulate Claude Haiku token usage per run, but token usage is currently discarded by every call site. As we add sources and increase recap detail, cost-per-run drifts upward invisibly. The admin needs a per-run cost breakdown to (a) catch regressions, (b) make scope/value tradeoffs (e.g. is web enrichment worth $X/run?), and (c) plan monthly spend.

## Context

- All LLM calls go through Vercel AI SDK `generateObject` (model: `claude-haiku-4-5-20251001` by default). The SDK response includes `usage: { promptTokens, completionTokens, totalTokens }` and `response.modelId` — already available, just unused.
- Three pipeline modules emit LLM cost:
  - `packages/pipeline/src/collectors/web.ts` — `webListing` (line 51) + `webExtraction` (line 74). Called N times per run depending on configured web sources.
  - `packages/pipeline/src/processors/rank.ts` — `rank` (line 219). Called once per run.
  - `packages/pipeline/src/processors/recap.ts` — `recap` (line 76). Called once per run (single batched call covering all top-N items + digest).
- Runs do NOT have a DB row while in flight. They only persist once they land in `run_archives` (status: completed / failed / cancelled). In-flight state lives in Redis run-state.
- Admin UI surfaces: `/admin` dashboard (recent-runs table) and `/admin/review/:runId` (per-run review page).

## Requirements

### Functional

- **FR1:** Capture token usage (`promptTokens`, `completionTokens`, `modelId`) at each of the four LLM call sites: webListing, webExtraction, rank, recap.
- **FR2:** Aggregate per-run into four stage buckets — `webListing`, `webExtraction`, `rank`, `recap` — each with `{ inputTokens, outputTokens, callCount, usdCost, model }`, plus a run-level total.
- **FR3:** Compute USD cost using Claude pricing constants sourced from the official Claude pricing docs (verified via context7 during implementation, not assumed).
- **FR4:** Persist cost breakdown to `run_archives.cost_breakdown` (jsonb, nullable) when the run completes (or fails/cancels with partial data).
- **FR5:** Display a `CostBreakdownCard` component on `/admin/review/:runId` showing per-stage rows + run total.
- **FR6:** On `/admin` dashboard, each row in the recent-runs table gets a small "$" button that opens a dialog rendering the same `CostBreakdownCard` for that run.
- **FR7:** Backwards-compatible: archives created before this feature have `cost_breakdown = null` — the component renders a "No cost data captured" state.

### Non-Functional

- **NF1:** Cost capture must never fail a pipeline stage. If usage data is missing from an SDK response, log a warning and record zeros for that call — never throw.
- **NF2:** Cost computation is pure (token counts × rates) — deterministic, testable without network.
- **NF3:** Pricing constants live in a single typed map keyed by model id, in `@newsletter/shared`, so both pipeline (capture) and web (display in case of future client-side recompute) can import. Single source of truth.
- **NF4:** No new runtime libraries required.

### Edge Cases

- **EC1:** A run fails mid-stage. Whatever stages completed before the failure should still record their cost. → Use a `RunCostAccumulator` instance scoped to the run, mutated as each call returns, flushed to DB at terminal status (completed OR failed OR cancelled).
- **EC2:** A run is cancelled (`run:cancel:{runId}` pub/sub). The cancel handler must flush partial accumulator state before exiting.
- **EC3:** SDK returns `usage: undefined` (rare, but possible on streaming errors or model fallbacks). Record `{ inputTokens: 0, outputTokens: 0 }` for that call and increment a `missingUsageCallCount` counter on the stage — surfaced in the UI as a small warning badge.
- **EC4:** A future model id (not in the pricing constant map). Compute zero cost, log a warning with the unknown modelId, increment `unknownModelCallCount` — UI shows a warning so we know to update pricing.
- **EC5:** Web collector runs many extraction calls in parallel (one per discovered listing item). Accumulator updates must be safe under concurrent appends — accumulator is mutated only after each `await generateObject(...)` returns on the single Node event loop, so no locking needed. (Documented constraint, not enforced by types.)

## Key Insights

1. **`usage` is already on the wire.** Vercel AI SDK puts `{ promptTokens, completionTokens, totalTokens }` on every `generateObject` result. We're not measuring — we're stopping the discard.
2. **Runs are ephemeral until they finish.** Persisting per-call rows during a run would need a new `runs` table. Per-stage aggregates flushed at completion fit cleanly into the existing `run_archives` row without touching the run lifecycle.
3. **Web has two distinct stages.** Listing (discovers items from a source page) and extraction (fetches each item) have very different cost profiles. Bucketing them together would hide the actual driver. Four stage buckets, not three.
4. **The same card, two contexts.** The dashboard button + dialog requirement means `CostBreakdownCard` must accept `costBreakdown` data as a prop (not fetch it itself), so the dashboard can prefetch (or the dialog can fetch on open) without coupling.

## Architectural Challenges

- **Capture seam.** Each of the four call sites needs to record usage without each becoming a copy-paste of bookkeeping code. Solution: a single `recordLlmUsage(stage, result)` helper that takes the SDK result and an accumulator reference. Three lines of mechanical change per call site.
- **Accumulator scope.** One `RunCostAccumulator` per run, created in `handleRunProcessJob` (which orchestrates the full run), passed down through the existing options-object pattern that web.ts/rank.ts/recap.ts already use (each has `options: { generateObject?, ... }` — we add `options.costAccumulator?`).
- **Pricing rate drift.** Claude prices change. We hardcode them in `@newsletter/shared/pricing/claude.ts` with a `lastVerified: '2026-05-18'` field per model. PR review = pricing audit. No DB seeding, no admin UI to edit — overengineering for a 2-person team.
- **Backwards compatibility.** `cost_breakdown` is a nullable jsonb column. UI handles null gracefully. No migration of historical data — pre-feature runs simply don't have it.

## Approaches Considered

### A. Per-stage aggregate in `run_archives.cost_breakdown` JSONB ✓ CHOSEN

- One nullable jsonb column on existing table.
- Accumulator built in memory during the run, flushed once at completion.
- No new table, no new migrations beyond the column add.
- Trade-off: can't drill into "which item cost the most to enrich?" — but that question isn't asked yet.

### B. New `cost_events` append-only table

- Per-call rows: `(id, run_id, stage, model, input_tokens, output_tokens, usd_cost, created_at)`.
- Maximum fidelity. Supports future "top N most expensive items" queries.
- Requires: new table, new repo, run_id FK that doesn't exist until run completes (or a separate `runs` table to anchor against), and one DB insert per LLM call (~50-200 inserts per run).
- Rejected: significantly more surface area for a question we don't have today. Aggregates can later be backfilled from event rows if we ever migrate, but the reverse is harder to justify.

### C. Per-run totals only

- Just `totalUsd` on the run_archive row.
- Cheapest, smallest diff.
- Rejected: the whole point of the feature is "which stage is expensive?". Per-run totals can't answer that.

## Chosen Approach: Per-Stage Aggregate (A)

### Data model

Add to `run_archives`:

```ts
costBreakdown: jsonb("cost_breakdown").$type<RunCostBreakdown | null>(),
```

```ts
// @newsletter/shared/types
export type LlmStage = "webListing" | "webExtraction" | "rank" | "recap";

export interface StageCost {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  usdCost: number;        // rounded to 6 decimals
  model: string;          // most-recent model id used in this stage
  missingUsageCallCount?: number;
  unknownModelCallCount?: number;
}

export interface RunCostBreakdown {
  stages: Partial<Record<LlmStage, StageCost>>;
  totalUsdCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  capturedAt: string;     // ISO timestamp
}
```

### Pricing constants

`packages/shared/src/pricing/claude.ts`:

```ts
export interface ClaudePricing {
  inputPerMTok: number;
  outputPerMTok: number;
  lastVerified: string;   // YYYY-MM-DD
  source: string;         // URL to docs.claude.com page consulted
}

export const CLAUDE_PRICING: Record<string, ClaudePricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMTok: 0,      // FILLED DURING IMPLEMENTATION from docs.claude.com via context7
    outputPerMTok: 0,
    lastVerified: "2026-05-18",
    source: "https://docs.claude.com/en/docs/about-claude/pricing",
  },
  // future models added on demand
};

export function computeUsdCost(modelId: string, inputTokens: number, outputTokens: number): { usdCost: number; unknownModel: boolean } { ... }
```

### Capture mechanism

A single helper:

```ts
// packages/pipeline/src/services/cost-accumulator.ts
export class RunCostAccumulator {
  private stages = new Map<LlmStage, StageCost>();
  record(stage: LlmStage, result: { usage?: { promptTokens?: number; completionTokens?: number }; response?: { modelId?: string } }, fallbackModelId: string): void { ... }
  snapshot(): RunCostBreakdown { ... }
}
```

Then in each call site (web.ts, rank.ts, recap.ts):
- Add `costAccumulator?: RunCostAccumulator` to options
- After `await generateObject(...)`, call `costAccumulator?.record(stage, result, modelId)`

In `handleRunProcessJob` (the orchestrator):
- Construct one accumulator at start of run
- Pass it down to web collector, rank processor, recap processor
- On run completion / failure / cancel, persist `accumulator.snapshot()` to `run_archives.cost_breakdown` via the existing run-archive repo's write path

### API surface

- `GET /api/archives/:runId` (public) — already returns the archive row. Add `costBreakdown` to its response shape. Public archive page does NOT render the cost card.
- `GET /api/admin/archives/:runId/cost` (admin) — explicit, focused endpoint for the dashboard dialog that wants just the cost data without rehydrating the entire archive payload. Returns `{ runId, costBreakdown }`. Gated by `requireAdmin`.

Decision: the dashboard dialog uses the focused endpoint so we don't refetch ranked-items/hydration just to render a 4-row card.

### UI

- New component: `packages/web/src/components/admin/CostBreakdownCard.tsx`. Props: `{ costBreakdown: RunCostBreakdown | null }`. Renders:
  - 4 stage rows (label, callCount, in-tokens, out-tokens, $cost)
  - Total row
  - Empty state if `costBreakdown === null`
  - Warning badge if any stage has `missingUsageCallCount > 0` or `unknownModelCallCount > 0`
- Placement 1: section on `/admin/review/:runId` (`ReviewPage.tsx`), data already on hand (already fetched as part of archive).
- Placement 2: small "$" icon button on each row in `DashboardPage.tsx`'s recent-runs table. Click → opens shadcn `Dialog` containing `<CostBreakdownCard costBreakdown={data} />`. Dialog open triggers a `useQuery` against `GET /api/admin/archives/:runId/cost`.

## High-Level Design

```
                ┌─────────────────────────────────────────┐
                │  handleRunProcessJob (pipeline worker)  │
                │                                         │
                │  new RunCostAccumulator()  ───────┐     │
                │                                   │     │
                │  ┌────────────────┐               │     │
                │  │ webCollector   │◄──passes──────┤     │
                │  │  listing()     │ accum         │     │
                │  │  extraction()  │               │     │
                │  └───────┬────────┘               │     │
                │          │ .record(stage, result) │     │
                │          ▼                        │     │
                │  ┌────────────────┐               │     │
                │  │  rank()        │◄──────────────┤     │
                │  └───────┬────────┘               │     │
                │          │ .record(...)           │     │
                │          ▼                        │     │
                │  ┌────────────────┐               │     │
                │  │  recap()       │◄──────────────┤     │
                │  └───────┬────────┘               │     │
                │          │ .record(...)           │     │
                │          ▼                        │     │
                │  accumulator.snapshot()           │     │
                │          │                        │     │
                │          ▼                        │     │
                │  runArchivesRepo.write({          │     │
                │    ..., costBreakdown: snapshot,  │     │
                │  })                               │     │
                └─────────────────────────────────────────┘
                           │
                           ▼
                  run_archives.cost_breakdown
                           │
                ┌──────────┼──────────┐
                ▼                     ▼
   GET /api/archives/:runId    GET /api/admin/archives/:runId/cost
   (public, includes field)    (admin, focused payload)
                │                     │
                ▼                     ▼
        ReviewPage card         DashboardPage dialog
        ─────────── shared ──────────────
              <CostBreakdownCard />
```

## Open Questions

1. **Public archive cost visibility.** Should `/archive/:runId` (public) also show the cost card? Default: NO — public visitors don't need to see API spend. Confirmed implicitly by "admin must be able to see". UI gates the component to admin contexts.
2. **Cost regression alerting.** Out of scope for MVP. Future: Slack notification if a run's total exceeds the rolling 7-day average by 2×.

## Risks & Mitigations

- **R1: Stale pricing constants.** Mitigation: `lastVerified` date in the constant map; reviewer checks it on every PR that touches `claude.ts`. UI shows the rate's `lastVerified` in the card footer ("Rates as of 2026-05-18") so freshness is visible.
- **R2: Accumulator not flushed on failure path.** Mitigation: flush is in a `finally` block in `handleRunProcessJob`, not the happy path. Unit-tested with a thrown error mid-rank.
- **R3: Cancellation path bypasses flush.** Mitigation: the cancel handler in the run worker already updates run status to `cancelled` and writes the archive row — we extend that write path with the accumulator snapshot. Same `finally` covers both completion and cancellation.

## Assumptions

- A1: Vercel AI SDK's `generateObject` returns `{ usage: { promptTokens, completionTokens, totalTokens }, response: { modelId } }`. **Verified during library probe against current `ai` package docs.**
- A2: Claude Haiku 4.5 is the only model in active use today. Pricing map starts with one entry; additions are cheap.
- A3: Token counts from the SDK reflect actual billable tokens (no separate cache-write or cache-read accounting needed for MVP — Anthropic's prompt caching tokens, if used, would need separate handling; check during library probe).
- A4: 6-decimal USD precision is enough (a single Haiku call is typically $0.0001–$0.01).

## External Dependencies & Fallback Chain

| Dependency | Purpose | Maturity | Fallback chain |
|---|---|---|---|
| `docs.claude.com` pricing page | Source for Haiku 4.5 input/output $/MTok rates | Official Anthropic docs | 1. context7 query for `claude pricing` → 2. WebFetch `https://docs.claude.com/en/docs/about-claude/pricing` → 3. Anthropic console pricing page → 4. Hardcode rates from Anthropic blog post / cached snapshot, flag `lastVerified` clearly |
| `ai` package (`generateObject`) — already in use | Returns `usage` field we depend on | Vercel AI SDK, actively maintained | If `result.usage` shape differs from assumed `{ promptTokens, completionTokens }`, library probe will catch it; recordLlmUsage helper has a defensive `usage?.promptTokens ?? 0` path |

No new runtime libraries.
