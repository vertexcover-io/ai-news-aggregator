# `@ai-sdk/*` `usage.inputTokens` INCLUDES `cachedInputTokens` for non-Anthropic providers — subtract before billing

The Vercel AI SDK reports `usage.inputTokens` differently across providers:

- **Anthropic**: `inputTokens` is already the cache-miss portion only. The cached count is reported separately in `providerMetadata.anthropic.usage.cache_read_input_tokens`.
- **Gemini, DeepSeek, and likely other AI-SDK-standardised providers**: `inputTokens` is the TOTAL including cached. `cachedInputTokens` is a subset of `inputTokens`.

A cost formula that does `inputTokens * inputRate + cachedInputTokens * cacheReadRate` works correctly for Anthropic but **double-bills the cached portion** for Gemini and DeepSeek.

## What bit us

`packages/shared/src/cost.ts::computeCallCost` was written for Anthropic semantics:

```ts
const costUsd =
  (inputTokens * pricing.inputPerMTok +
   outputTokens * pricing.outputPerMTok +
   cachedInputTokens * pricing.cacheReadPerMTok +
   ...) / 1_000_000;
```

When the Gemini integration shipped, no one verified the SDK's per-provider `inputTokens` convention. The Gemini extractor (`extractGeminiUsage`) just passed `inputTokens` through unchanged — same as Anthropic — which silently double-billed the cache portion for every Gemini call. The bug lived for months without detection because the absolute cost numbers stayed in the right order of magnitude.

The DeepSeek-swap PR (`feat/deepseek-v4-web-discovery`) caught it because the live library-probe captured `{ inputTokens: 351, cachedInputTokens: 256 }` plus `providerMetadata.deepseek.{ promptCacheHitTokens: 256, promptCacheMissTokens: 95 }` — and `256 + 95 = 351` made the inclusion semantics obvious.

## The fix

Both `extractDeepSeekUsage` and `extractGeminiUsage` now subtract `cachedInputTokens` from `inputTokens` BEFORE returning the components:

```ts
return {
  inputTokens: Math.max(0, totalInput - cached),  // cache-miss portion only
  outputTokens: usage?.outputTokens ?? 0,
  cachedInputTokens: cached,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  reasoningTokens: usage?.reasoningTokens ?? 0,
};
```

`computeCallCost` is unchanged; `extractAnthropicUsage` is unchanged (the Anthropic SDK already returns cache-miss-only).

## Rule

When adding a new `@ai-sdk/<provider>`:

1. **Run a live probe with the same prompt called twice** to force a cache hit on the second call.
2. **Capture the raw `usage` shape** from both calls.
3. **Verify the relationship** between `inputTokens` and `cachedInputTokens`:
   - If `inputTokens === cacheMissTokens + cachedInputTokens` → the SDK reports TOTAL. Your extractor must subtract before billing.
   - If `inputTokens === cacheMissTokens` (no `cachedInputTokens` field, or `cachedInputTokens` separate) → the SDK already excludes. Pass through unchanged.
4. **Add the round-trip cost-math test** with the captured probe values as the fixture. The expected USD must be hand-calculated from the cache-miss portion at full rate.

## Heuristic

If `costUsd` for a cache-heavy workload is unexpectedly high (close to the no-cache rate, even though you observe `cachedInputTokens > 0` in the breakdown), suspect double-billing in the extractor. The fix is one line in the extractor, not the formula.

## Generalisation

The Anthropic-shaped convention "give me the bill, not the total" is the more useful semantic — it makes the formula straightforward. But the AI SDK never promised a unified convention. Treat each new provider as having its own convention until the live probe says otherwise.

## Related

- `.claude/rules/learnings/cross-phase-type-alignment.md` — the same "capture live shape before writing types" principle, applied to cross-phase type design.
- `.claude/rules/learnings/cache-vs-spec-promise-review.md` — same vantage-point lesson; walk the call graph from the user-visible promise (here: "cost is correctly priced including cache") and inspect every step.
