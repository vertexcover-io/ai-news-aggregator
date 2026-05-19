# SPEC: Admin Pipeline Cost Analysis

**Source:** `docs/spec/admin-pipeline-cost-analysis/design.md`
**Library probe:** `docs/spec/admin-pipeline-cost-analysis/library-probe.md` (verdict: PASS)
**Generated:** 2026-05-19

---

## Goal

Admins can see the per-run LLM cost analysis of every pipeline run via a `Cost` button on each row of the `/admin` runs list. Clicking the button opens a dialog with a per-stage breakdown of token usage, model, and USD cost.

## Scope

In: token + cost tracking for the four LLM call sites in the pipeline (`collectors/web.ts::discoverPostUrls`, `collectors/web.ts::extractPostFields`, `processors/rank.ts::rerank`, `processors/recap.ts::generateRecap`); a new nullable JSONB column on `run_archives`; an extended `RunSummary` shape on the existing admin run-summary endpoints; a per-row Cost button + CostDialog on the admin dashboard.

Out: cross-run cost analytics on `/admin/analytics`; non-LLM infrastructure cost (Crawlee/proxies/Resend/Twitter API); real-time streaming cost; public-facing cost surfaces; new LLM call sites.

---

## Requirements

### Cost computation (`@newsletter/shared`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall provide `MODEL_PRICING: Record<string, ModelPricing>` exporting per-MTok rates for every model id referenced by current pipeline code. | `MODEL_PRICING["claude-haiku-4-5-20251001"]` has fields `inputPerMTok=1`, `outputPerMTok=5`, `cacheReadPerMTok=0.10`, `cacheWrite5mPerMTok=1.25`, `cacheWrite1hPerMTok=2`; `MODEL_PRICING["claude-sonnet-4-6"]` has `inputPerMTok=3`, `outputPerMTok=15`, `cacheReadPerMTok=0.30`, `cacheWrite5mPerMTok=3.75`, `cacheWrite1hPerMTok=6`. | Must |
| REQ-002 | Ubiquitous | `ModelPricing` shall NOT contain a `reasoningPerMTok` field. | TypeScript type definition has exactly five rate fields. | Must |
| REQ-003 | Event-driven | When `computeCallCost(components, modelId)` is called with a `modelId` present in `MODEL_PRICING`, the system shall return a numeric `costUsd` equal to `inputPerMTok·inputTokens/1e6 + outputPerMTok·(outputTokens+reasoningTokens)/1e6 + cacheReadPerMTok·cachedInputTokens/1e6 + cacheWrite5mPerMTok·cacheCreation5mTokens/1e6 + cacheWrite1hPerMTok·cacheCreation1hTokens/1e6`. | Unit test: for `modelId="claude-haiku-4-5-20251001"` and `components={inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, reasoningTokens: 0}`, returns `costUsd === 6.0`. | Must |
| REQ-004 | Unwanted | If `computeCallCost` is called with a `modelId` not in `MODEL_PRICING`, then the system shall return `costUsd === null`. | Unit test: `computeCallCost({...}, "made-up-model")` returns `{ costUsd: null }`. | Must |
| REQ-005 | Event-driven | When `extractAnthropicUsage(usage, providerMetadata)` is called with a Vercel AI SDK `usage` object, the system shall return `{ inputTokens, outputTokens, cachedInputTokens, cacheCreation5mTokens, cacheCreation1hTokens, reasoningTokens }` where each value is read from the SDK fields verified in library-probe. | Unit test against the live-probe sample: `inputTokens=699, outputTokens=24, cachedInputTokens=0, cacheCreation5mTokens=0, cacheCreation1hTokens=0, reasoningTokens=0`. | Must |
| REQ-006 | Unwanted | If `usage.reasoningTokens` is `undefined` in the SDK response, then `extractAnthropicUsage` shall return `reasoningTokens: 0`. | Unit test: input usage with no `reasoningTokens` key returns `reasoningTokens === 0`. | Must |
| REQ-007 | Unwanted | If `providerMetadata.anthropic.usage.cache_creation` is `undefined`, then `extractAnthropicUsage` shall return `cacheCreation5mTokens: 0` and `cacheCreation1hTokens: 0`. | Unit test: providerMetadata without `cache_creation` returns both fields as 0. | Must |

### Data model (`@newsletter/shared`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Ubiquitous | The `run_archives` table shall have a nullable JSONB column `cost_breakdown`. | Migration applied; `\d run_archives` shows `cost_breakdown jsonb` with `NOT NULL` absent. | Must |
| REQ-011 | Ubiquitous | The system shall export a `RunCostBreakdown` TypeScript type with fields `schemaVersion: 1`, `stages: Record<CostStage, StageCost>`, `totalCostUsd: number \| null`, `unknownModels: string[]`, `generatedAt: string`. | TypeScript compilation passes. | Must |
| REQ-012 | Ubiquitous | The system shall define `CostStage = "web-discovery" \| "web-extraction" \| "rank" \| "recap"`. | TypeScript compilation passes; no other stage values accepted. | Must |
| REQ-013 | Ubiquitous | `StageCost` and `ModelStageCost` shall include `cacheCreation5mTokens` and `cacheCreation1hTokens` as separate numeric fields (NOT a combined `cacheCreationTokens`). | TypeScript type definition contains both names; no `cacheCreationTokens` field exists. | Must |

### Cost tracker (`@newsletter/pipeline`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Event-driven | When `createCostTracker(runId)` is called, the system shall return a `CostTracker` with `record`, `snapshot`, and `merge` methods. | Unit test asserts all three methods are defined. | Must |
| REQ-021 | Event-driven | When `tracker.record({ stage, modelId, usage, providerMetadata })` is called, the system shall accumulate token counts into `stages[stage].byModel[modelId]` and recompute that model row's `costUsd` via `computeCallCost`. | Unit test: two `record()` calls with the same stage+model produce a single `byModel` entry with summed token fields and `calls=2`. | Must |
| REQ-022 | Event-driven | When `tracker.snapshot()` is called, the system shall return a `RunCostBreakdown` whose `stages[s].costUsd` equals the sum of `byModel[*].costUsd` for that stage, treating `null` as `0` only if at least one entry is priced. | Unit test: stage with one priced ($0.10) and one unpriced model produces `stages[s].costUsd === 0.10` and `costStatus === "partial-unknown-model"`. | Must |
| REQ-023 | Event-driven | When `tracker.snapshot()` is called and ALL entries in a stage have `costUsd === null`, the system shall return `stages[s].costUsd === null` and `costStatus === "all-unknown-model"`. | Unit test: stage with only unpriced models returns `costUsd: null`, `costStatus: "all-unknown-model"`. | Must |
| REQ-024 | Event-driven | When `tracker.snapshot()` is called and every priced model id is in `MODEL_PRICING`, the system shall return `stages[s].costStatus === "ok"`. | Unit test: stage with only priced models returns `costStatus: "ok"`. | Must |
| REQ-025 | Event-driven | When `tracker.merge(existing)` is called with a non-null prior `RunCostBreakdown`, the system shall accumulate prior token counts and call counts BEFORE applying any new records. | Unit test: tracker with one new call + an existing snapshot with one prior call produces totals equal to sum. | Must |
| REQ-026 | Event-driven | When `tracker.snapshot()` returns a `RunCostBreakdown`, the `unknownModels` array shall list every distinct model id seen during the run that lacks a `MODEL_PRICING` entry, with no duplicates. | Unit test: record same unknown model twice + a priced model — `unknownModels` has exactly one entry. | Must |
| REQ-027 | Ubiquitous | `RunCostBreakdown.totalCostUsd` shall equal the sum of `stages[*].costUsd` treating `null` as `0`, returning `null` only when ALL stages are `null`. | Unit test: 3 priced stages + 1 null stage produces a non-null total equal to the priced sum. | Must |

### LLM call-site wiring (`@newsletter/pipeline`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Event-driven | When `discoverPostUrls(listingUrl, listingMarkdown, model, reportUsage?)` completes successfully and `reportUsage` is supplied, the system shall invoke `reportUsage(result.usage, result.providerMetadata)` exactly once. | Unit test: stubbed `generateObject` returns canned usage; `reportUsage` mock is called once with the canned values. | Must |
| REQ-031 | Event-driven | When `extractPostFields(postUrl, postMarkdown, model, reportUsage?)` completes successfully and `reportUsage` is supplied, the system shall invoke `reportUsage(result.usage, result.providerMetadata)` exactly once. | Same as REQ-030 for `extractPostFields`. | Must |
| REQ-032 | Event-driven | When `rerank(...)` completes successfully and a tracker is provided, the system shall record one `tracker.record({ stage: "rank", ... })` entry using the `modelId` resolved at call time. | Unit test using existing rank test harness with stubbed `generateObject`. | Must |
| REQ-033 | Event-driven | When `generateRecap(...)` completes successfully and a tracker is provided, the system shall record one `tracker.record({ stage: "recap", ... })` entry. | Unit test. | Must |
| REQ-034 | Unwanted | If a wrapped LLM call throws, the system shall not invoke `reportUsage`/`tracker.record` for that call. | Unit test: stubbed `generateObject` rejects; `reportUsage` mock not called. | Must |
| REQ-035 | Ubiquitous | The `reportUsage` / tracker parameter shall be optional on all four call sites so existing test doubles continue to pass without modification. | Existing rank/recap/web-collector unit tests pass unchanged after the additive signature change. | Must |

### Run finalisation (`@newsletter/pipeline`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Event-driven | When `handleRunProcessJob` finishes (success, failed-with-progress, or cancelled), the system shall persist `tracker.snapshot()` to `run_archives.cost_breakdown` for the run, IF AND ONLY IF the tracker recorded at least one call. | E2E test: a run with stubbed LLM responses writes a non-null `cost_breakdown` row; a run that throws before any LLM call leaves `cost_breakdown` NULL. | Must |
| REQ-041 | Event-driven | When `hydrateAddedPost` runs the add-post flow successfully, the system shall write `tracker.merge(existing).snapshot()` back to `run_archives.cost_breakdown` for that run. | E2E test: add-post on a run that already has `cost_breakdown.recap.calls=0` produces `recap.calls=1` and prior stages unchanged. | Must |
| REQ-042 | Ubiquitous | `RunCostBreakdown.schemaVersion` shall equal `1` for every breakdown written by this feature. | DB row assertion in E2E test. | Must |

### API (`@newsletter/api`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Event-driven | When an authenticated admin requests `GET /api/runs/:runId`, the system shall include a `costBreakdown: RunCostBreakdown \| null` field in the response. | Integration test: admin cookie set; response body has `costBreakdown` key. | Must |
| REQ-051 | Event-driven | When the dashboard runs-list endpoint returns run summaries to an admin, each row shall include `costBreakdown: RunCostBreakdown \| null`. | Integration test. | Must |
| REQ-052 | Unwanted | If a request to `GET /api/runs/:runId` arrives WITHOUT a valid admin session, then the system shall respond with HTTP 401 and shall not include cost data anywhere in the response. | Integration test: missing cookie returns 401; response body has no `costBreakdown` key and no token counts. | Must |
| REQ-053 | Ubiquitous | The public `/api/archives` and `/api/archives/:runId` endpoints shall NOT return `costBreakdown` or any token-usage fields. | Integration test: response shape lacks cost fields. | Must |

### Web UI (`@newsletter/web`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Ubiquitous | The system shall render a `Cost` button on every row of the admin runs list in both `RunsTable` and `RunsCardList`, regardless of whether `costBreakdown` is null. | Playwright test: every row has an element with `data-testid="cost-button"`. | Must |
| REQ-061 | Event-driven | When `costBreakdown` is non-null and `totalCostUsd` is a number, the Cost button label shall render the value as `Cost: $X.XXX` (3 decimal places). | Component test: `totalCostUsd=0.637` → button text is `Cost: $0.637`. | Must |
| REQ-062 | Event-driven | When `costBreakdown` is non-null and `totalCostUsd` is `null`, the Cost button label shall be `Cost: ?` and display a visible warning indicator. | Component test renders warning indicator when `costStatus !== "ok"`. | Must |
| REQ-063 | Event-driven | When `costBreakdown` is `null` (pre-feature run), the Cost button label shall be `Cost` with no amount. | Component test. | Must |
| REQ-064 | Event-driven | When the Cost button is clicked, the system shall open a dialog containing a table with columns: `Stage`, `Calls`, `In tok`, `Out tok`, `Cached`, `Thinking`, `Model`, `Cost`. | Playwright test: dialog opens with all eight column headers visible. | Must |
| REQ-065 | Event-driven | When the dialog is open and `costBreakdown` is `null`, the dialog body shall display empty-state copy referencing the feature launch date constant from `@newsletter/shared/constants`. | Component test: rendering with `costBreakdown={null}` shows the empty-state text. | Must |
| REQ-066 | Event-driven | When a stage's `byModel` map has more than one entry, the dialog shall render the aggregate stage row plus one indented sub-row per model id. | Component test with fixture containing two models in one stage. | Must |
| REQ-067 | Event-driven | When a stage has zero calls, the dialog shall render its numeric cells as `—`. | Component test. | Must |
| REQ-068 | Ubiquitous | The dialog shall display `totalCostUsd` in the header, formatted as `$X.XXX` when numeric or `?` when null. | Component test for both states. | Must |
| REQ-069 | Ubiquitous | The Cost button shall NOT appear anywhere on public routes (`/`, `/archive/:runId`, `/confirm`, `/unsubscribe`, `/privacy`, `/terms`). | Playwright test: navigate to each public route as anonymous user; no `data-testid="cost-button"` present. | Must |

### Formatting helpers (`@newsletter/web`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-080 | Event-driven | When `formatCostUsd(n)` receives a finite number, the system shall return a string `$` followed by the number rendered to 3 decimal places. | Unit test: `formatCostUsd(0.041) === "$0.041"`. | Must |
| REQ-081 | Unwanted | If `formatCostUsd(n)` receives `null`, then the system shall return the string `?`. | Unit test. | Must |
| REQ-082 | Unwanted | If `formatCostUsd(n)` receives `0`, then the system shall return `$0.000` (not `—`). | Unit test. | Must |
| REQ-083 | Event-driven | When `formatTokens(n)` receives a number ≥ 1_000_000, the system shall format it as `<x>.<y>M` (one decimal) — e.g. `1_234_567 → "1.2M"`. | Unit test. | Must |
| REQ-084 | Event-driven | When `formatTokens(n)` receives a number ≥ 1_000 and < 1_000_000, the system shall return the value with comma thousands separators (e.g. `48210 → "48,210"`). | Unit test. | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | A run completes with zero LLM calls (e.g. settings disable web/rank). | `run_archives.cost_breakdown` is NULL (not an empty breakdown). UI shows pre-feature empty-state. | REQ-040, REQ-063 |
| EDGE-002 | A run is cancelled mid-stage after web-extraction has recorded N calls. | `cost_breakdown` is non-null with the partial counts; status fields reflect cancellation but cost rows persist. | REQ-040 |
| EDGE-003 | An LLM call returns a `usage` object with `reasoningTokens` present and > 0 (someone enables extended thinking). | `extractAnthropicUsage` returns the value as-is; `computeCallCost` prices it at the model's `outputPerMTok`. | REQ-005, REQ-003 |
| EDGE-004 | `RANKING_MODEL` env is set to an id absent from `MODEL_PRICING`. | Tokens are still recorded; `byModel[<id>].costUsd === null`; stage `costStatus === "partial-unknown-model"` or `"all-unknown-model"`; `unknownModels` contains the id; dialog shows `?` + warning chip. | REQ-004, REQ-023, REQ-026, REQ-062 |
| EDGE-005 | Same stage receives calls with two different model ids during one run. | `byModel` has two entries; aggregate stage row shows summed totals; dialog renders aggregate + 2 indented model sub-rows. | REQ-021, REQ-066 |
| EDGE-006 | Add-post flow runs on a reviewed run whose `cost_breakdown` is `null`. | Tracker treats `existing` as `null`, snapshots only the recap call, writes the row; non-recap stages have zero calls. | REQ-025, REQ-041 |
| EDGE-007 | The Vercel AI SDK adds a new `usage` field in a future release. | `extractAnthropicUsage` ignores unknown fields; existing six normalized fields keep working. | REQ-005 |
| EDGE-008 | Two concurrent admin clients load the dashboard and one opens the Cost dialog while a run is still in progress. | The button renders with whatever `costBreakdown` value the API returned (null or partial). No race protection needed — the snapshot is read-only on the client. | REQ-060 |
| EDGE-009 | A run produces a stage where every call uses a freshly cached prompt (`cacheReadInputTokens` > 0, `inputTokens` near 0). | Cost is computed with `cacheReadPerMTok` for the cached portion; `costUsd > 0` and renders correctly. | REQ-003 |
| EDGE-010 | An admin opens the Cost dialog, closes it, opens another run's dialog. | Each open shows the correct run's breakdown; no stale data leaks from the previous open. | REQ-064 |
| EDGE-011 | `cost_breakdown` JSONB stored from a future schemaVersion (e.g. v2). | Hydration reads schemaVersion; v2 rows are treated as unparseable and the UI shows the pre-feature empty-state. | REQ-011, REQ-065 |
| EDGE-012 | Anonymous user requests `GET /api/runs/<known-runId>` while a valid admin session exists in another browser. | Server returns 401 to the anonymous request; admin session in the other browser is unaffected. | REQ-052 |

---

## Verification Matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-001 | Yes | No | No | No | `shared/pricing.test.ts` |
| REQ-002 | Yes | No | No | No | Type-level test or runtime `Object.keys` assertion |
| REQ-003 | Yes | No | No | No | `shared/cost.test.ts` |
| REQ-004 | Yes | No | No | No | `shared/cost.test.ts` |
| REQ-005 | Yes | No | No | No | Use fixture from `probes/usage-shape.live.log` |
| REQ-006 | Yes | No | No | No | |
| REQ-007 | Yes | No | No | No | |
| REQ-010 | No | Yes | No | No | Drizzle migration applied; `\d` inspection in integration test |
| REQ-011 | Yes | No | No | No | TypeScript compile check |
| REQ-012 | Yes | No | No | No | |
| REQ-013 | Yes | No | No | No | |
| REQ-020 | Yes | No | No | No | `pipeline/services/cost-tracker.test.ts` |
| REQ-021 | Yes | No | No | No | |
| REQ-022 | Yes | No | No | No | |
| REQ-023 | Yes | No | No | No | |
| REQ-024 | Yes | No | No | No | |
| REQ-025 | Yes | No | No | No | |
| REQ-026 | Yes | No | No | No | |
| REQ-027 | Yes | No | No | No | |
| REQ-030 | Yes | No | No | No | extend `collectors/web.test.ts` |
| REQ-031 | Yes | No | No | No | extend `collectors/web.test.ts` |
| REQ-032 | Yes | No | No | No | extend `processors/rank.test.ts` |
| REQ-033 | Yes | No | No | No | extend `processors/recap.test.ts` |
| REQ-034 | Yes | No | No | No | |
| REQ-035 | Yes | No | No | No | Existing tests must continue to pass |
| REQ-040 | No | No | Yes | No | pipeline e2e with stubbed model |
| REQ-041 | No | No | Yes | No | pipeline e2e |
| REQ-042 | No | No | Yes | No | E2E asserts column value |
| REQ-050 | No | Yes | No | No | `api/tests/integration/runs.test.ts` extend |
| REQ-051 | No | Yes | No | No | |
| REQ-052 | No | Yes | No | No | |
| REQ-053 | No | Yes | No | No | |
| REQ-060 | Yes | No | Yes | No | Component + Playwright |
| REQ-061 | Yes | No | No | No | `CostDialog.test.tsx` |
| REQ-062 | Yes | No | No | No | |
| REQ-063 | Yes | No | No | No | |
| REQ-064 | No | No | Yes | No | Playwright |
| REQ-065 | Yes | No | No | No | |
| REQ-066 | Yes | No | No | No | |
| REQ-067 | Yes | No | No | No | |
| REQ-068 | Yes | No | No | No | |
| REQ-069 | No | No | Yes | No | Playwright walks public routes |
| REQ-080 | Yes | No | No | No | `cost-format.test.ts` |
| REQ-081 | Yes | No | No | No | |
| REQ-082 | Yes | No | No | No | |
| REQ-083 | Yes | No | No | No | |
| REQ-084 | Yes | No | No | No | |
| EDGE-001 | No | No | Yes | No | |
| EDGE-002 | No | No | Yes | No | |
| EDGE-003 | Yes | No | No | No | |
| EDGE-004 | Yes | No | Yes | No | |
| EDGE-005 | Yes | No | No | No | |
| EDGE-006 | No | No | Yes | No | |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | No | No | No | Yes | Manual smoke during functional-verify |
| EDGE-009 | Yes | No | No | No | |
| EDGE-010 | No | No | Yes | No | Playwright |
| EDGE-011 | Yes | No | No | No | |
| EDGE-012 | No | Yes | No | No | |

---

## Verification Scenarios (functional-verify replays these live)

### VS-0: Vercel AI SDK usage shape still matches `extractAnthropicUsage`
**Type:** live API probe
**Run:**
```bash
cd packages/pipeline
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY' ../../.env | cut -d= -f2-) \
  pnpm tsx ../../docs/spec/admin-pipeline-cost-analysis/probes/usage-shape.mjs
```
**Expected:** exit 0; `usage` contains `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens` (numbers); `providerMetadata.anthropic.usage.cache_creation` contains both `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` (numbers); `providerMetadata.anthropic.cacheCreationInputTokens` is a number.
**Why this matters:** if SDK renames or moves a field, `extractAnthropicUsage` silently zeros out → we under-bill.

### VS-1: End-to-end run records cost
**Type:** pipeline e2e
**Steps:** trigger `POST /api/runs/now` with stubbed model returning canned usage → wait for run completion → query `run_archives.cost_breakdown` for the run id.
**Expected:** `cost_breakdown` is non-null; per-stage rows match expected token totals from the stubbed returns; `totalCostUsd > 0`; `schemaVersion === 1`.

### VS-2: Cost dialog renders on dashboard
**Type:** Playwright
**Steps:** log in to `/admin` → locate most recent run row → click `data-testid="cost-button"` → screenshot dialog.
**Expected:** dialog visible with eight column headers (Stage, Calls, In tok, Out tok, Cached, Thinking, Model, Cost); `totalCostUsd` shown in header.

### VS-3: Pre-feature run shows empty state
**Type:** Playwright
**Steps:** insert a `run_archives` row with `cost_breakdown = NULL` via direct DB write → open `/admin` → click Cost button on that row.
**Expected:** empty-state copy referencing feature launch date is shown; no per-stage table.

### VS-4: Unknown model handling
**Type:** pipeline e2e + Playwright
**Steps:** set `RANKING_MODEL=claude-opus-99-experimental` (absent from `MODEL_PRICING`) → trigger a run → open Cost dialog.
**Expected:** token counts persisted for the rank stage; `byModel[<unknown>].costUsd === null`; stage `costStatus !== "ok"`; dialog shows `?` and a warning chip listing the unknown model.

### VS-5: Cancelled run records partial cost
**Type:** pipeline e2e
**Steps:** trigger run → after first LLM call observes a usage record, publish to `run:cancel:{runId}` → wait for run state to reach `cancelled`.
**Expected:** `cost_breakdown` is non-null; contains the partial usage from before the cancel; final run status is `cancelled`.

### VS-6: Add-post merges into existing breakdown
**Type:** pipeline e2e
**Steps:** on a reviewed run with existing `cost_breakdown` (rank + web stages have call counts) → POST `/api/admin/archives/:runId/add-post` with a URL.
**Expected:** `cost_breakdown.recap.calls` increases by 1; web + rank stage values unchanged; `generatedAt` updated.

---

## Out of Scope

- Cross-run cost trends, time-series charts, or per-source cost breakdown on `/admin/analytics`.
- Non-LLM cost (Crawlee/proxy egress, Twitter API, Resend, Slack, LinkedIn).
- Settings UI for editing `MODEL_PRICING`; the map is code-owned.
- Real-time cost streaming during a run (the snapshot is finalised on run completion or add-post).
- Public-facing cost surfaces. `costBreakdown` MUST NOT appear on `/`, `/archive/:runId`, or any unauthenticated route.
- Cost alerts, budgets, or thresholds.
- Backfilling cost data for runs that completed before this migration.
- Tracking cost incurred by failed (non-billed) LLM requests — Anthropic does not bill these.
- Latency metrics. The dialog is cost-only; wall-clock latency per stage is explicitly excluded.
- A new `llm_calls` table. The chosen data model is per-stage JSONB on `run_archives`.

---

## Implementation Notes (carried forward from design + library-probe)

### Verified MODEL_PRICING values (USD per million tokens)

| Model id | Input | 5m write | 1h write | Cache read | Output |
|---|---:|---:|---:|---:|---:|
| `claude-haiku-4-5-20251001` | 1.00 | 1.25 | 2.00 | 0.10 | 5.00 |
| `claude-sonnet-4-6` | 3.00 | 3.75 | 6.00 | 0.30 | 15.00 |

Reasoning (thinking) tokens are billed at the model's **output** rate; there is no separate reasoning rate.

### SDK field mapping (verified live in library-probe)

`extractAnthropicUsage(usage, providerMetadata)` reads:
- `inputTokens` ← `usage.inputTokens`
- `outputTokens` ← `usage.outputTokens`
- `cachedInputTokens` ← `usage.cachedInputTokens` (cache READ)
- `cacheCreation5mTokens` ← `providerMetadata.anthropic.usage.cache_creation.ephemeral_5m_input_tokens ?? 0`
- `cacheCreation1hTokens` ← `providerMetadata.anthropic.usage.cache_creation.ephemeral_1h_input_tokens ?? 0`
- `reasoningTokens` ← `usage.reasoningTokens ?? 0`

### File layout

- `packages/shared/src/pricing.ts` — `ModelPricing` type + `MODEL_PRICING` map
- `packages/shared/src/cost.ts` — `computeCallCost`, `extractAnthropicUsage`
- `packages/shared/src/types/cost-breakdown.ts` — `CostStage`, `StageCost`, `ModelStageCost`, `RunCostBreakdown`
- `packages/shared/src/constants.ts` — extend with `COST_TRACKING_LAUNCHED_AT` (ISO date string set when migration ships)
- `packages/shared/src/db/schema.ts` — add `costBreakdown` column to `runArchives`
- `packages/shared/migrations/<timestamp>_add_run_cost_breakdown.sql` — Drizzle Kit generated
- `packages/pipeline/src/services/cost-tracker.ts` — `createCostTracker`, `CostTracker`
- `packages/pipeline/src/collectors/web.ts` — add optional `reportUsage` to `discoverPostUrls`, `extractPostFields`, and the call-site closures in `collectWeb`
- `packages/pipeline/src/processors/rank.ts` — add optional tracker; wire in `rerank` callsite
- `packages/pipeline/src/processors/recap.ts` — add optional tracker
- `packages/pipeline/src/workers/run-process.ts` — create tracker; snapshot + persist on finalize
- `packages/pipeline/src/services/add-post-helper.ts` — merge tracker with existing on add-post
- `packages/pipeline/src/repositories/run-archives.ts` (or whichever owns the row) — add `setCostBreakdown(runId, breakdown)`
- `packages/api/src/routes/runs.ts` — extend run-summary shape with `costBreakdown`
- `packages/web/src/api/runs.ts` — extend `RunSummary` type
- `packages/web/src/components/dashboard/CostDialog.tsx` — new
- `packages/web/src/components/dashboard/CostButton.tsx` — new (extracted from RunsTable/RunsCardList)
- `packages/web/src/components/dashboard/cost-format.ts` — `formatTokens`, `formatCostUsd`
- `packages/web/src/components/dashboard/RunsTable.tsx` — add Cost column
- `packages/web/src/components/dashboard/RunsCardList.tsx` — add Cost button in actions
- `packages/web/src/pages/DashboardPage.tsx` — mount `CostDialog` and own dialog state

### Test files

- `packages/shared/src/pricing.test.ts`
- `packages/shared/src/cost.test.ts`
- `packages/pipeline/src/services/cost-tracker.test.ts`
- `packages/pipeline/src/collectors/web.test.ts` (extend)
- `packages/pipeline/src/processors/rank.test.ts` (extend)
- `packages/pipeline/src/processors/recap.test.ts` (extend)
- `packages/pipeline/tests/e2e/cost-tracking.e2e.test.ts` (new)
- `packages/api/tests/integration/runs.test.ts` (extend)
- `packages/web/src/components/dashboard/CostDialog.test.tsx`
- `packages/web/src/components/dashboard/cost-format.test.ts`
- `packages/web/tests/e2e/cost-dialog.spec.ts` (Playwright)
