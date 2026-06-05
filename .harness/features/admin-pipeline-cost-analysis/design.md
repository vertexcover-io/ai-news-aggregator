# Admin Pipeline Cost Analysis — Design

**Spec name:** `admin-pipeline-cost-analysis`
**Branch:** `feat/admin-pipeline-cost-analysis` (off `revert/admin-cost-analysis`)
**Status:** Draft — design approved, pending library-probe verification of pricing + SDK field names
**Date:** 2026-05-19

---

## Goal

Admins must be able to see the cost analysis (LLM token usage + USD cost) of each pipeline run from the admin page. Best placement: a **Cost button per run row on `/admin`** that opens a dialog showing a detailed per-stage breakdown.

## Scope

In scope:

- Persist per-stage LLM cost and token usage on every pipeline run (success, failed-with-progress, cancelled).
- Cover all four current LLM call sites in the pipeline: web-collector discovery, web-collector extraction, stage-2 rerank, and add-post recap.
- Surface the data in the `/admin` runs list as a per-row Cost button that opens a `CostDialog`.
- Handle historical runs (pre-feature) with a graceful empty state.
- Handle unknown model ids (pricing not configured) by recording tokens and showing `?` with a warning chip.

Out of scope:

- Cross-run cost trends or charts (could live on `/admin/analytics` later).
- Non-LLM infrastructure cost (Crawlee proxies, Twitter API calls, Resend).
- Real-time cost streaming during a run.
- Public-facing cost surfaces.

## Non-LLM cost

The web *crawler* itself (`services/web-crawler.ts` — Crawlee + Readability + Turndown) and `services/web-fetch/*` are HTTP-only and incur no LLM cost. The four cost-incurring call sites today are:

1. `collectors/web.ts::discoverPostUrls` — Vercel AI SDK `generateObject`, default model `claude-haiku-4-5-20251001`.
2. `collectors/web.ts::extractPostFields` — `generateObject`, same model.
3. `processors/rank.ts::rerank` — `generateObject`, env `RANKING_MODEL` (current code default: `claude-sonnet-4-6`; note CLAUDE.md says haiku — design treats whatever the env yields as authoritative).
4. `processors/recap.ts::generateRecap` — `generateObject`, default `claude-haiku-4-5-20251001`. Invoked only from the add-post flow on `/admin/review/:runId`.

## External Dependencies & Fallback Chain

Library-probe will verify these before any code is written.

1. **Anthropic pricing** (per-million-token rates for input, output, cache-read, cache-write-5m, cache-write-1h, reasoning) for each model id we reference.
   - Primary source: <https://docs.anthropic.com/en/docs/about-claude/pricing>
   - Fallback: <https://www.anthropic.com/pricing>
   - Model ids to confirm:
     - `claude-haiku-4-5-20251001` (web-discovery, web-extraction, recap default)
     - `claude-sonnet-4-6` (rank default per current code)
   - If a referenced model id is not advertised by Anthropic, library-probe must flag it and the design must be updated to use the correct id.
2. **Vercel AI SDK usage extraction** — exact field names on `LanguageModelUsage` and on `providerMetadata.anthropic`. Library-probe must run a real (or recorded) `generateObject` call against Anthropic with our exact SDK versions and dump the shape.
   - Primary source: Vercel AI SDK docs via Context7 (`/vercel/ai`).
   - Fields we depend on (subject to library-probe verification):
     - `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`
     - `usage.cachedInputTokens` (or equivalent on `providerMetadata.anthropic`)
     - `usage.reasoningTokens` (extended thinking; 0 when disabled)
     - `providerMetadata.anthropic.cacheCreationInputTokens` (or whatever the v5 SDK exposes for cache writes; 5m / 1h split if available)
   - Fallback: if the SDK does not expose cache fields directly on `usage`, read from `providerMetadata.anthropic`. If neither path exists, scope cache tokens out for v1 and record only input/output/reasoning.
   - Trust gate: probe writes a small TS script that prints the live usage object to `docs/spec/admin-pipeline-cost-analysis/probes/`; `extractAnthropicUsage` mirrors those exact field accesses.

If library-probe finds the SDK or Anthropic docs incompatible with this plan, design must be revised before implementation.

---

## Section 1 — Architecture & data flow

**Accumulation point** (pipeline package): one `CostTracker` instance per run.

- Created at the top of `workers/run-process.ts::handleRunProcessJob`.
- Passed into the web collector (which threads it to `discoverPostUrls` and `extractPostFields`) and into `rerank()`.
- For the add-post flow, `services/add-post-helper.ts::hydrateAddedPost` creates a tracker, reads the existing `cost_breakdown` from `run_archives`, calls `tracker.merge(existing)` then `generateRecap` (which reports usage via the tracker), then writes the merged snapshot back.

**Cost math** (shared package): pure function `computeCallCost(components, modelId)` in `@newsletter/shared/cost.ts`. Returns `{ costUsd: number | null }`. Returns `null` when `MODEL_PRICING[modelId]` is undefined. Token components are still recorded regardless.

**Persistence point**: at run finalize (success, failed-with-progress, cancelled) the worker calls `runArchivesRepo.setCostBreakdown(runId, tracker.snapshot())`. Failed-before-any-LLM-call runs skip the write (no calls recorded → tracker is empty → no row update needed).

**Surface point**: extend `GET /api/runs/:runId` and the dashboard runs list endpoint with a `costBreakdown: RunCostBreakdown | null` field. Web client renders a Cost button per row that opens a `CostDialog`.

**Why this placement (the user's question "best placement"):** the dashboard runs list is the only place an operator sees all runs at once. Surfacing cost there mirrors the existing Sources/Review/View-Archive button pattern. The review page is for curation, not operations. `/admin/analytics` is for cross-run trends — out of scope here.

---

## Section 2 — DB schema + cost data shape

### Migration

Add one nullable JSONB column to `run_archives` via Drizzle Kit.

```sql
ALTER TABLE run_archives ADD COLUMN cost_breakdown jsonb;
```

Drizzle schema in `packages/shared/src/db/schema.ts`:

```ts
costBreakdown: jsonb("cost_breakdown").$type<RunCostBreakdown | null>(),
```

### Types (`@newsletter/shared/types`)

```ts
export type CostStage = "web-discovery" | "web-extraction" | "rank" | "recap";

export interface ModelStageCost {
  modelId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  costUsd: number | null;        // null if modelId has no pricing entry
}

export interface StageCost {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  byModel: Record<string, ModelStageCost>;
  costUsd: number | null;        // null only if ALL calls used unpriced models
  costStatus: "ok" | "partial-unknown-model" | "all-unknown-model";
}

export interface RunCostBreakdown {
  schemaVersion: 1;
  stages: Record<CostStage, StageCost>;
  totalCostUsd: number | null;   // null if everything unpriced
  unknownModels: string[];       // distinct model ids with no price
  generatedAt: string;           // ISO timestamp
}
```

**Design choices:**

- `null` cost vs `0` cost: zero is a legitimate value (cached-only call). `null` plus `costStatus` lets the dialog distinguish "no price configured" from "genuinely free".
- `byModel` inside a stage: `RANKING_MODEL` env can change between runs (or even within a deploy); persisting per-model rows preserves attribution.
- `cacheCreationTokens` is separate from `inputTokens`: cache writes are priced at +25 % (5m) or +100 % (1h) over base input on Anthropic. If lumped, we under-bill.
- `schemaVersion: 1` lets future readers safely detect old rows.

### Pricing map (`packages/shared/src/pricing.ts`)

```ts
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  reasoningPerMTok: number;
}

// Verified against Anthropic docs by library-probe.
// Do not edit numbers here without re-running library-probe.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // To be populated by library-probe with verified values for:
  //   claude-haiku-4-5-20251001
  //   claude-sonnet-4-6
};
```

### Backwards compatibility

Column is nullable. Hydration helpers return `costBreakdown: null` for rows where the column is `NULL`. UI renders an empty state.

---

## Section 3 — Cost tracker + LLM call-site wiring

### Cost tracker (`packages/pipeline/src/services/cost-tracker.ts`)

```ts
export interface CostTracker {
  record(input: {
    stage: CostStage;
    modelId: string;
    usage: LanguageModelUsage;
    providerMetadata?: ProviderMetadata;
  }): void;
  snapshot(): RunCostBreakdown;
  merge(existing: RunCostBreakdown | null): RunCostBreakdown;
}

export function createCostTracker(runId: string): CostTracker;
```

Stage attribution:

| Call site | Stage |
|---|---|
| `collectors/web.ts::discoverPostUrls` | `web-discovery` |
| `collectors/web.ts::extractPostFields` | `web-extraction` |
| `processors/rank.ts::rerank` | `rank` |
| `processors/recap.ts::generateRecap` | `recap` |

### Call-site wiring (additive)

Each helper grows one optional callback parameter so existing test doubles keep working unchanged:

```ts
type UsageReporter = (usage: LanguageModelUsage, providerMetadata?: ProviderMetadata) => void;

export async function discoverPostUrls(
  listingUrl: string,
  listingMarkdown: string,
  model: LanguageModel,
  reportUsage?: UsageReporter,
): Promise<DiscoveredPost[]> {
  const result = await generateObject({ model, schema: DiscoverySchema, /* ... */ });
  reportUsage?.(result.usage, result.providerMetadata);
  return result.object.posts;
}
```

Same shape applied to `extractPostFields`, `rerank`, `generateRecap`.

The caller (`collectWeb`, the run-process worker, the add-post helper) constructs an `UsageReporter` closure that calls `tracker.record({ stage, modelId, usage, providerMetadata })`. The model id is passed explicitly because `LanguageModel` does not expose it reliably across SDK versions — callers already know the string they used in `anthropic("…")`.

### Usage extraction (`packages/shared/src/cost.ts`)

```ts
function extractAnthropicUsage(
  usage: LanguageModelUsage,
  providerMetadata?: ProviderMetadata,
): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
};
```

This is the single SDK-coupled function. Its implementation mirrors the field accesses verified by library-probe and uses 0 defaults for missing optional fields.

### Idempotency

- `run-process` job uses `jobId: runId`; BullMQ deduplicates retries. A successful run finalises the breakdown once.
- Add-post is a single API request → single handler invocation → read-modify-write within the same DB transaction. No concurrent merges.

### Failure paths

- LLM call throws: usage never reported. Anthropic does not bill failed requests. Tracker shape stays accurate.
- Downstream throw after LLM success: tracker already has the call recorded. The run-finalize block writes the snapshot in a `finally`-style handler so partial cost is persisted.
- Cancellation: same as above — whatever was reported before the abort is snapshotted.

---

## Section 4 — API + Web UI

### API

- `GET /api/runs/:runId` — add `costBreakdown: RunCostBreakdown | null` to the response (admin-gated).
- Dashboard runs-list endpoint — add the same field per row. Avoids a second fetch when opening the dialog.
- No new endpoints. Public archive routes unchanged — cost data never leaks to `/` or `/archive/:runId`.

### Typed API client

`packages/web/src/api/runs.ts` extends `RunSummary` with `costBreakdown: RunCostBreakdown | null`. The `RunCostBreakdown` type is imported from `@newsletter/shared/types` — single source of truth for backend response and frontend rendering. No duplication, no DTO mapping.

### Button placement

`RunsTable.tsx` (≥ 640 px tabular layout) — new column between **Sources** and **Actions**:

```
| Date | Status | Items | Sources | Cost | Actions |
```

`RunsCardList.tsx` (< 640 px stacked) — the Cost button joins the existing action button row alongside Sources / Review / View Archive.

Button label rules:

| `costBreakdown` state | Label |
|---|---|
| `null` (pre-feature run) | `Cost` |
| `totalCostUsd = 0` (no LLM calls recorded) | `Cost: $0.00` |
| `totalCostUsd = number` | `Cost: $0.064` (3 decimals so sub-cent runs are readable) |
| `totalCostUsd = null` (all models unpriced) | `Cost: ?` with a warning dot |

### CostDialog layout

```
COST BREAKDOWN — Run 2026-05-19 14:00                       Total: $0.637

Stage           Calls  In tok    Out tok   Cached    Thinking  Model        Cost
─────────────────────────────────────────────────────────────────────────────────
web-discovery     12   48,210     3,140        0         0    haiku-4.5   $0.041
web-extraction    87  612,450    42,800    18,000        0    haiku-4.5   $0.512
rank               1   18,400     4,210     2,400        0    sonnet-4.6  $0.084
recap              0       —          —        —         —    —           —

Unknown models: (none)              Cost data captured at 2026-05-19 14:42
                                                                       [Close]
```

Rules:

- Stage with zero calls renders numeric cells as `—`.
- Stage with multiple models (`byModel` length > 1) shows the aggregate row, then indented sub-rows per model id.
- Cost cell renders `?` with a warning chip when `costStatus !== "ok"`; tooltip lists offending model ids.
- Total renders to 3 decimal places; falls back to `?` when null.

Empty state for pre-feature runs:

```
COST BREAKDOWN — Run 2025-12-04

  No cost data for this run.
  Cost tracking was added on <FEATURE_LAUNCH_DATE>; this run pre-dates that change.

                                                                       [Close]
```

`<FEATURE_LAUNCH_DATE>` is exported from `@newsletter/shared/constants` and set when the migration ships.

### Formatting helpers (`packages/web/src/components/dashboard/cost-format.ts`)

- `formatTokens(n)` → `48,210` / `1.2M`
- `formatCostUsd(n | null)` → `$0.041` / `?` / `—`

Unit-tested.

### Dependencies

No new dependencies. Existing Tailwind + shadcn `Dialog`/`Table` primitives (already used by `SourcesDialog`) cover the UI.

---

## Section 5 — Testing strategy + verification scenarios

### Unit tests

| Package | File | Coverage |
|---|---|---|
| `@newsletter/shared` | `pricing.test.ts` | `MODEL_PRICING` has every model id referenced by code; every entry has all six rate fields. |
| `@newsletter/shared` | `cost.test.ts` | `computeCallCost`: known model → expected USD; unknown model → null cost + tokens preserved; cache mix priced correctly; reasoning tokens contribute when > 0. |
| `@newsletter/shared` | `cost.test.ts` | `extractAnthropicUsage`: SDK shapes from probe map correctly; missing optional fields default to 0. |
| `@newsletter/pipeline` | `services/cost-tracker.test.ts` | `record` accumulates per stage + per model; `snapshot` totals; `merge` is non-destructive; `costStatus` transitions. |
| `@newsletter/pipeline` | `processors/rank.test.ts` (extend) | Stub `generateObject` returns canned usage → tracker callback fires with the right stage. |
| `@newsletter/pipeline` | `collectors/web.test.ts` (extend) | `discoverPostUrls` / `extractPostFields` call `reportUsage` when supplied; no-op otherwise. |
| `@newsletter/web` | `CostDialog.test.tsx` | Empty state when `null`; per-stage rows when present; warning chip when `costStatus !== "ok"`; per-model expansion when `byModel.length > 1`. |
| `@newsletter/web` | `cost-format.test.ts` | Formatting edge cases (zero, sub-cent, M-suffix, null). |

### E2E tests (`@newsletter/pipeline` e2e project)

| Scenario |
|---|
| Minimal pipeline with stubbed model returning canned usage → assert `cost_breakdown` JSONB matches expected per-stage values. |
| Cancel mid-stage → assert partial `cost_breakdown` is persisted. |
| Add-post on reviewed run → assert merge increments only the recap stage. |

### API integration tests

`GET /api/runs/:runId` includes `costBreakdown`; returns `null` for pre-feature rows; admin-gated.

### Playwright (web e2e)

Log in → open Cost dialog on a run with breakdown → screenshot. Open on pre-feature run → assert empty state.

### Verification scenarios (functional-verify will re-run)

- **VS-0** — Library-probe contract: live `generateObject` against Anthropic returns usage shape matching `extractAnthropicUsage`.
- **VS-1** — End-to-end run records cost to `run_archives.cost_breakdown`.
- **VS-2** — Cost dialog renders on dashboard with correct columns + total.
- **VS-3** — Pre-feature run (NULL column) shows empty state.
- **VS-4** — Unknown `RANKING_MODEL` → tokens recorded, cost null, warning chip shown.
- **VS-5** — Cancelled run still records partial cost.
- **VS-6** — Add-post merges into existing breakdown without losing previous stages.

---

## Implementation order (high level — planning will refine)

1. `@newsletter/shared`: types, pricing map (numbers filled after library-probe), `computeCallCost`, `extractAnthropicUsage`. Unit tests.
2. Drizzle migration adding `cost_breakdown` column. Run on local DB to verify.
3. `@newsletter/pipeline`: `cost-tracker.ts` service + unit tests. Wire `discoverPostUrls`, `extractPostFields`, `rerank`, `generateRecap` with optional `reportUsage` callback. Run worker creates tracker; add-post helper merges.
4. `@newsletter/api`: extend run-summary response with `costBreakdown`. Integration tests.
5. `@newsletter/web`: `CostDialog`, `cost-format`, `CostButton` row cell on `RunsTable` + card on `RunsCardList`. Unit tests + Playwright spec.
6. E2E pipeline tests.
7. Manual smoke test on a real (small) run.
