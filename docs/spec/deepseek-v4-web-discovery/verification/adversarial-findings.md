# Adversarial Findings — deepseek-v4-web-discovery

**Run:** 2026-05-28 13:14 · **Approach:** Try to break the feature before shipping. List what was attempted, what was found, and what was deferred.

## Scenarios attempted

### A1: What if `DEEPSEEK_API_KEY` is missing/empty at runtime?

**Probe:** `process.env.DEEPSEEK_API_KEY` is `undefined` → `createDeepSeek({ apiKey: undefined })` will throw at first call site (`generateObject(...)`) when DeepSeek's HTTP layer fails auth. The pipeline will return a `failed` source unit for any blog source. Same blast radius as the pre-existing Gemini path. **Not a regression.**

**Status:** Acceptable. The web-collector failure mode is well-isolated (per-source `Promise.allSettled` in `run-process`). Operator surfaces will report the failing source in Slack via the `sourceDistribution` notification.

### A2: What if `MODEL_PRICING["deepseek-chat"]` is missing?

**Probe:** Delete the entry, re-run cost tests. `computeCallCost(components, "deepseek-chat")` returns `{ costUsd: null }` (guarded by `if (!(modelId in MODEL_PRICING))`). The `byModel` row will surface as `costStatus: "all-unknown-model"` in the dashboard. **Graceful degradation — no crash.**

**Status:** Acceptable. Same behaviour as any other unpriced model.

### A3: What if DeepSeek silently changes `deepseek-chat` alias to V5?

**Probe:** The `WEB_COLLECTOR_MODEL_ID` constant is hard-coded to `"deepseek-chat"`. If the alias shifts, `MODEL_PRICING["deepseek-chat"]` would still apply the V4 rates — but the actual billed rate from DeepSeek could differ. The `costStatus` would still be `"ok"` (we don't compare against ground truth), so silent mispricing is possible.

**Mitigation in place:** Spec § 6 explicitly calls this risk. The `providerMetadata.deepseek` block carries debug fields (`promptCacheHitTokens`, `promptCacheMissTokens`) that an operator can sanity-check against DeepSeek's billing dashboard periodically. Not a blocker for ship; flagged as ongoing-operation risk.

**Status:** Risk acknowledged; documented in spec. No code action.

### A4: What if a single prompt exceeds DeepSeek's 1M context?

**Probe:** The discovery prompt is capped at `COMBINED_DISCOVERY_CAP = 120_000` chars (~30k tokens) in `web.ts:29`. Well under 1M. **Not reachable in practice.** Even if the cap were lifted, DeepSeek would return a 400 and the pipeline would mark that source unit failed — same as a transient network error.

**Status:** Not exercised; defensive code path is the existing per-source try/catch.

### A5: What if `extractDeepSeekUsage` receives a missing or malformed `usage` object?

**Probe:** `extractDeepSeekUsage(undefined)` returns `{inputTokens:0, outputTokens:0, cachedInputTokens:0, cacheCreation5m:0, cacheCreation1h:0, reasoning:0}` (all defaults). `computeCallCost(zeros, "deepseek-chat")` returns `{costUsd: 0}`. **Safe.**

**Status:** Acceptable. Existing unit tests cover the undefined-usage path.

### A6: What if pass-1's fix to `extractGeminiUsage` breaks legacy Gemini cost rows?

**Probe:** Critical concern raised by pass-1 reviewer. The Gemini extractor was changed to subtract `cachedInputTokens` from `inputTokens`. Historical `cost_breakdown` JSONB rows already in `run_archives` were computed with the OLD extractor (no subtraction) and the OLD bug (double-billing). When the dashboard re-renders an old run's cost, it does NOT re-run the extractor — it reads the stored `byModel[].inputTokens` value directly. **So historical rows render unchanged.** Only new runs use the fixed math.

**Status:** Safe. Verified via `packages/shared/src/cost.ts::parseRunCostBreakdown` — it parses the stored shape, doesn't recompute.

### A7: What if `@ai-sdk/deepseek@1.0.41` has a bug we missed?

**Probe:** Package is recent (last publish 2026-05-26, 2 days before this work) and the registry shows 285 versions over a ~year of active development. The live probe exercised structured-output, cache hit, and error-free response — the actual SDK code path we use. No anomalies. **Not exhaustively tested**, but the package surface we touch is minimal: `createDeepSeek` + `generateObject` integration via the AI SDK's standard `LanguageModel` interface.

**Status:** Acceptable risk for a small dep with a healthy publish cadence. Library-probe at `library-probe.md` is the verification gate.

### A8: What if removing `@ai-sdk/google` breaks a non-obvious transitive caller?

**Probe:** After removal, `pnpm typecheck` and `pnpm lint` were both clean across the monorepo. `grep -rn "@ai-sdk/google" packages/` returns zero matches. No other package referenced it (it was pipeline-only). **Safe.**

**Status:** Verified clean.

## Defects found in adversarial pass

None new. All adversarial scenarios either passed cleanly or were pre-existing accepted risks documented in the spec.

## Deferred to future operation

- **A3 (alias drift):** ongoing monitoring task; not a code change.
- **VS-4 (e2e cost attribution):** operator's first real run-now after deploy will exercise the full chain end-to-end.

## Verdict

**PASS.** The feature is shippable. No remaining Critical or Important defects beyond the operator-action items already documented in `proof-report.md`.
