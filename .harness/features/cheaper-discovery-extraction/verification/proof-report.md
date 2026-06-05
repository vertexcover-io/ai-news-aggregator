# Proof Report — cheaper-discovery-extraction

**Feature:** Move web-collector discovery + extraction LLM calls from Anthropic Claude Haiku to Gemini 3.1 Flash-Lite (`@ai-sdk/google`), with provider-aware cost extraction + a new pricing entry. Pipeline + shared + docs only; no UI surface.
**Verified:** 2026-05-27
**Overall verdict:** **PASS**

`claims.json`: executed=118, passed=118, failed=0, **0 UI claims** → Playwright UI verification not applicable (Step 4 skipped per skill: spec has no `type:"ui"` claims and no `VS-*` of type ui).

## 1. Summary table

| Scenario | Type | Description | Verdict |
|----------|------|-------------|---------|
| VS-0-discovery | api | Live `@ai-sdk/google` discovery `generateObject` | PASSED (orchestrator live probe) |
| VS-0-extraction | api | Live `@ai-sdk/google` extraction `generateObject` | PASSED (orchestrator live probe) |
| VS-0-usage-shape | api | Gemini `result.usage` = `{inputTokens,outputTokens,totalTokens}`, no cache keys | PASSED (orchestrator live probe) |
| REQ-001/002/003 | unit | web.ts uses Google provider, model id `gemini-3.1-flash-lite`, keyed by `GEMINI_API_KEY` | PASSED (static + unit) |
| REQ-004 | unit | discovery/extraction record `modelId: gemini-3.1-flash-lite` | PASSED (unit) |
| REQ-005 | unit | pricing table exact gemini values | PASSED (static + re-derivation) |
| REQ-006/008 | unit | gemini usage extraction + cost math | PASSED (fresh re-derivation) |
| REQ-007 | unit | anthropic extraction path unchanged | PASSED (fresh re-derivation) |
| REQ-009 | static | `@ai-sdk/google` pinned 2.0.74, pipeline-only | PASSED (grep) |
| REQ-010 | static | shortlist/rerank/recap unchanged on Anthropic | PASSED (grep) |
| REQ-011 | static | `GEMINI_API_KEY` in `.env.example` + CLAUDE.md | PASSED (grep) |
| EDGE-001/003/004/007 | unit | usage-shape / unknown-model / historical / cache carry-through | PASSED (fresh re-derivation) |
| EDGE-002 | unit | mixed-provider cost sum | PASSED (unit, in 1022 green) |
| EDGE-005/006 | static | per-source error isolation on key/transient failure | PASSED (control-flow trace) |

## 2. API evidence

No new HTTP routes in this feature. The only "api"-type scenarios are the VS-0 live library probes against Gemini, executed independently by the orchestrator (verify agent does not re-run; cited as evidence):

```
LIVE VS-0 PROBE (orchestrator, packages/pipeline, .harness/.../probes/ai-sdk-google/probe.mjs):
  DISCOVERY ok — posts: 3
  EXTRACTION ok — title: "How we cut LLM costs 40% with model routing"
  USAGE SHAPE: {"inputTokens":147,"outputTokens":191,"totalTokens":338}   (no cachedInputTokens/reasoningTokens keys)
  providerMetadata.google present, no usage/cache subfields
```

This confirms VS-0-discovery, VS-0-extraction, and VS-0-usage-shape. The usage shape is the exact input the REQ-006 Gemini extractor is built to handle.

## 3. UI evidence

Not applicable. `claims.json` has 0 `type:"ui"` claims; spec defines no `VS-*` of type ui; the feature touches `packages/shared` + `packages/pipeline` only (no `packages/web` changes — confirmed by `git status`). No screenshots required.

## 4. DB evidence

No schema/migration change in this feature (the `run_archives.cost_breakdown` JSONB column is pre-existing). "db"-type claims (PHASE1-C1..C4) are pure-function assertions on the built `@newsletter/shared`. Fresh re-derivation this session against `packages/shared/dist`:

```
extractUsage(gemini, 147/191): {"inputTokens":147,"outputTokens":191,"cachedInputTokens":0,"cacheCreation5mTokens":0,"cacheCreation1hTokens":0,"reasoningTokens":0}
computeCallCost gemini 147/191: 0.00032325  (expected 0.00032325) OK          # REQ-008, EDGE-001
computeCallCost gemini 1M/1M:   1.75         (expected 1.75)        OK          # REQ-008
extractUsage(anthropic): {... "cacheCreation5mTokens":4,"cacheCreation1hTokens":2 ...}  OK (cache tiers routed)   # REQ-007
EDGE-007 carry-through cachedInputTokens: 30  OK                                  # EDGE-007
EDGE-003 unknown model costUsd: null  OK (null)                                   # EDGE-003
EDGE-004 anthropic entries present: OK                                            # EDGE-004
REQ-005 gemini pricing: {"inputPerMTok":0.25,"outputPerMTok":1.5,"cacheReadPerMTok":0.025,"cacheWrite5mPerMTok":0,"cacheWrite1hPerMTok":0}   # REQ-005
```

This independently reproduces the orchestrator's cost re-derivation. Static source confirmation:
- `packages/shared/src/pricing.ts:31-37` — gemini entry exact values (REQ-005).
- `packages/shared/src/cost.ts:75-82` — `extractUsage` routes `gemini-` ids to `extractGeminiUsage`, all others to `extractAnthropicUsage` (REQ-006/REQ-007).
- `packages/pipeline/src/collectors/web.ts:27` `WEB_COLLECTOR_MODEL_ID="gemini-3.1-flash-lite"`; `:195-200` `resolveDefaultModel` builds via `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })`; `:215,:225` both stages record the gemini model id (REQ-001/002/003/004).

## 5. Visual anomalies & UX observations

Not applicable — no UI surface. No screenshots to review.

## 6. Spec coverage table

| REQ/EDGE | Scenario | Evidence | Verdict |
|----------|----------|----------|---------|
| REQ-001 | web.ts model id + Google provider | `web.ts:27,197-199`; `web.test.ts::resolveDefaultModel provider` (green) | MET |
| REQ-002 | extraction records gemini id | `web.ts:221-229`; `web.test.ts::records modelId gemini-3.1-flash-lite` (green) | MET |
| REQ-003 | provider reads GEMINI_API_KEY | `web.ts:198`; `web.test.ts::keyed by GEMINI_API_KEY` (green) | MET |
| REQ-004 | cost stages record gemini id | `web.ts:215,225`; `cost-tracker.test.ts::REQ-004` (green) | MET |
| REQ-005 | pricing exact values | `pricing.ts:31-37`; re-derivation §4 | MET |
| REQ-006 | gemini usage extraction | `cost.ts:64-73`; re-derivation §4 (cache tiers→0) | MET |
| REQ-007 | anthropic extraction unchanged | `cost.ts:47-62,80-81`; re-derivation §4 (cache5m=4,1h=2) | MET |
| REQ-008 | computeCallCost numeric | re-derivation §4 (1.75 / 0.00032325 exact) | MET |
| REQ-009 | dep pinned, pipeline-only | `pipeline/package.json:28` `"2.0.74"`; absent in shared/api/web | MET |
| REQ-010 | shortlist/rerank/recap unchanged | grep: rank.ts/recap.ts/shortlist.ts still `@ai-sdk/anthropic` + `claude-haiku-4-5-20251001` | MET |
| REQ-011 | env docs | `.env.example:18` `GEMINI_API_KEY=`; CLAUDE.md required-env paragraph lists `GEMINI_API_KEY` | MET |
| EDGE-001 | omitted cache keys | re-derivation §4 (no crash, cachedInputTokens=0) | MET |
| EDGE-002 | mixed-provider sum | `cost-tracker.test.ts::EDGE-002` (green) | MET |
| EDGE-003 | unknown model → null | re-derivation §4 (costUsd=null) | MET |
| EDGE-004 | anthropic entries retained | re-derivation §4 (entries present) | MET |
| EDGE-005 | unset key → per-source fail | `web.ts:324-336` per-source try/catch under `Promise.allSettled`; control-flow trace ADV-8 | MET |
| EDGE-006 | transient denial → per-source fail | `web.ts:445-455`; ADV-9 | MET |
| EDGE-007 | cachedInputTokens carry-through | re-derivation §4 (=30) | MET |

No `NOT VERIFIED` rows.

## 7. E2E coverage summary

Coding-stage test evidence re-run fresh this session as the verification evidence run:

- `pnpm --filter @newsletter/shared test:unit` → **302 passed (30 files)** — matches expected.
- `pnpm --filter @newsletter/pipeline test:unit` → **1022 passed (87 files)** — matches expected.

Claims `COVERED_BY_E2E`: PHASE1-C1..C4 (pricing/cost pure fns), PHASE2-C1..C5 (web-collector model id + cost-tracker integration) — all cited via `proven_by` and confirmed green in the suites above. PHASE2-C6 (VS-0 live probe) confirmed by the orchestrator's live probe (§2).

## 8. Adversarial findings

Full detail in `verification/adversarial-findings.md`. **Adversarial pass clean — 11 scenarios attempted, all behaved correctly (0 defects).** Categories exercised: boundary inputs, provider mis-routing, numeric exactness, unknown-model fallback, historical-data regression, mixed-provider accounting, per-source error isolation, dependency-leak regression, unchanged-stage regression.

Most promising attack (quoted): "ADV-3 (provider mis-route) — the `extractUsage` dispatcher keys on `modelId.startsWith("gemini-")` … my hypothesis was that … a careless refactor could send an Anthropic call down the Gemini branch and silently zero its `cache_creation` ephemeral tiers (a real money bug). It didn't land: the current Anthropic ids do not start with `gemini-`, the Anthropic branch is the default fall-through (not an allow-list that could miss a new id), and the live re-derivation confirmed `cacheCreation5m=4`/`1h=2` survive the Anthropic id."

## 9. Not executed

- **Live unset-`GEMINI_API_KEY` network call (EDGE-005/006).** Proved statically via control-flow trace of the per-source `try/catch` + `Promise.allSettled`; not forced as a live 401/denied call. Spec marks these Manual / existing-error-handling, no new behavior — acceptable non-execution.
- **A full pipeline run end-to-end** (collect→dedup→shortlist→rank→persist cost_breakdown). Out of scope for this gate; requires DB+Redis+live Gemini and exercises far more than this feature's diff. The cost-persistence path is unchanged by this feature (only the model id + provider differ), and is covered by pre-existing cost-tracking e2e + the unit suites above.

## 10. Infrastructure

No infrastructure started by this gate. No DB/Redis/web server required — all evidence is pure-function re-derivation against the built `@newsletter/shared/dist`, static source inspection, grep, and re-running the unit suites. The live VS-0 probe was run by the orchestrator (with `GEMINI_API_KEY` from `.env.harness`), not by this gate. Nothing to clean up.
