# Adversarial Findings — cheaper-discovery-extraction

**Role:** critic (post role-swap). Goal: break the feature, not confirm it.
**Context break honoured:** re-read only `spec.md` + `claims.json` before generating scenarios; did not re-read any draft proof report.
**Surface:** pipeline + shared only. No UI, no HTTP routes added → no browser/curl attack surface. Attack surface is the pure cost functions, the provider wiring, and the per-source collector error path.

## 1. Attack surface derived

Computed by diffing spec ACs (REQ-001…011, EDGE-001…007) against `claims.json` `claims[]` (PHASE1-C1..C4, PHASE2-C1..C6) and probing the boundaries the happy-path claims do not exercise:

- **Cost-function boundaries (spec-gap):** unset/empty `GEMINI_API_KEY` at runtime (EDGE-005 — marked Manual in the matrix, no unit test); unknown model id at runtime (EDGE-003); `cachedInputTokens > 0` carry-through (EDGE-007); Gemini usage object with NO cache keys at all (EDGE-001, observed live shape).
- **Provider-routing boundaries (claim-coverage-gap):** does `extractUsage` mis-route a non-`gemini-` id into the Gemini extractor and silently zero out the Anthropic cache tiers? (regression risk for REQ-007 / EDGE-004).
- **Mixed-provider accounting (derived):** a single run that records both a Gemini web stage and an Anthropic rank stage — does `totalCostUsd` double-count, drop a provider, or leak into `unknownModels`? (EDGE-002).
- **Historical-data regression (derived):** does adding the Gemini pricing row remove/shadow the Anthropic entries, breaking pre-change cost breakdowns? (EDGE-004).
- **Per-source isolation (spec-gap):** does a thrown discovery/extraction LLM call abort the whole `blog` crawl or only fail that source? (EDGE-005 / EDGE-006).

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-1 | Boundary input | Gemini usage with NO cache/reasoning keys (live probe shape) | `extractUsage("gemini-3.1-flash-lite", {inputTokens:147,outputTokens:191,totalTokens:338}, {google:{}})` | EXPECTED — returns all six components, cache tiers + reasoning forced to 0, no crash |
| ADV-2 | Boundary input | `cachedInputTokens > 0` (implicit cache hit) carry-through | `extractUsage(gemini, {in:100,out:50,cachedInputTokens:30}, {google:{}})` | EXPECTED — `cachedInputTokens:30` carried through; priced at $0.025/MTok |
| ADV-3 | Provider mis-route | Anthropic id must NOT take the Gemini branch (would zero cache tiers) | `extractUsage("claude-haiku-4-5-20251001", {in:10,out:20,cachedInputTokens:5}, {anthropic:{usage:{cache_creation:{ephemeral_5m_input_tokens:4,ephemeral_1h_input_tokens:2}}}})` | EXPECTED — routed to Anthropic extractor: `cacheCreation5m=4`, `cacheCreation1h=2` preserved |
| ADV-4 | Boundary value | Unknown model id at pricing time → null, not crash, not NaN | `computeCallCost(geminiComponents, "gemini-unknown-model")` | EXPECTED — `costUsd === null` (EDGE-003 preserved) |
| ADV-5 | Numeric exactness | Float drift on the documented 1M/1M and live-probe samples | `computeCallCost` 1M/1M and 147/191 | EXPECTED — `1.75` and `0.00032325` exactly (=== match, no epsilon needed) |
| ADV-6 | Historical regression | Adding Gemini row must not drop Anthropic rows | `MODEL_PRICING` key presence after change | EXPECTED — `claude-haiku-4-5-20251001` + `claude-sonnet-4-5-20250929` still present (EDGE-004) |
| ADV-7 | Mixed-provider accounting | One tracker records Gemini web-discovery + Anthropic rank | cost-tracker unit test EDGE-002 | EXPECTED — `totalCostUsd` sums both, both model ids surfaced, `unknownModels` empty (proven by `cost-tracker.test.ts::EDGE-002`, in the 1022 green) |
| ADV-8 | Error recovery / isolation | Unset `GEMINI_API_KEY` → does the whole blog crawl abort? | static path trace of `collectWeb` per-source `Promise.allSettled` + per-source `try/catch` | EXPECTED — discovery `generateObject` throw is caught at `web.ts:324`, logged `collector.web.discovery_failed`, returns `{sourceFailed:true}`; other sources continue (EDGE-005). No unhandled rejection. |
| ADV-9 | Error recovery | Transient "project denied access" (observed once in probe) | same per-source path as ADV-8 (extraction `try/catch` at `web.ts:445`) | EXPECTED — treated as per-source failure, run continues; no new retry logic introduced (EDGE-006, matches Out-of-Scope) |
| ADV-10 | Dependency boundary | `@ai-sdk/google` leaked into shared/api/web? | grep package.json across all packages | EXPECTED — present only in `packages/pipeline/package.json` pinned `2.0.74`; absent elsewhere (REQ-009) |
| ADV-11 | Regression | shortlist/rerank/recap silently moved off Anthropic? | grep `@ai-sdk/anthropic` + `claude-haiku` in rank.ts/recap.ts/shortlist.ts | EXPECTED — all three still import `@ai-sdk/anthropic`, model `claude-haiku-4-5-20251001` (REQ-010) |

ADV-1 through ADV-6 were executed live against the **built** `@newsletter/shared/dist` (fresh re-derivation this session — output captured in proof-report §DB evidence). ADV-7 is covered by a green unit test in the 1022 suite. ADV-8/9 are static control-flow traces of `web.ts` (no live Gemini key needed to prove the catch placement). ADV-10/11 are grep-confirmed.

## 3. Defects

None. No `DEFECT`-class outcome across the 11 scenarios.

## 4. Cannot assess

- **EDGE-005/EDGE-006 with a genuinely live unset-key network call.** I proved the *catch placement* statically (the throw cannot escape the per-source `try/catch`, and sources run under `Promise.allSettled`), which is the behavioural guarantee the spec asks for. I did not force a live Gemini 401/denied call this session — the orchestrator's live VS-0 probe ran with a valid key and PASSED, and the spec explicitly marks EDGE-005/006 as "Manual / covered by existing per-source error handling, no new behavior." This is an acceptable non-execution, not a gap.

## 5. Honest declaration

**No defects found across 11 scenarios attempted.** Categories exercised: boundary inputs (null/missing/oversized usage keys), provider mis-routing, numeric exactness, unknown-model fallback, historical-data regression, mixed-provider accounting, per-source error isolation, dependency-leak regression, unchanged-stage regression.

The most promising attack was **ADV-3 (provider mis-route)** — the `extractUsage` dispatcher keys on `modelId.startsWith("gemini-")`, so my hypothesis was that a future Anthropic id with an unlucky prefix, or a careless refactor, could send an Anthropic call down the Gemini branch and silently zero its `cache_creation` ephemeral tiers (a real money bug, since cache writes are billed). It didn't land: the current Anthropic ids do not start with `gemini-`, the Anthropic branch is the default fall-through (not an allow-list that could miss a new id), and the live re-derivation confirmed `cacheCreation5m=4`/`1h=2` survive the Anthropic id. The branch is correct for every id in the pricing table today and degrades safely (Anthropic extractor, then unknown-model→null) for any id it doesn't recognise.
