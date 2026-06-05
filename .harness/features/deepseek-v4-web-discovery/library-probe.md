# Library Probe — deepseek-v4-web-discovery

> **Run at:** 2026-05-28 12:48
> **Verdict:** PASS

## Summary

| Library | Health | Smoke | Final |
|---|---|---|---|
| `@ai-sdk/deepseek` (npm, `ai-v5` dist-tag) | trusted (latest 2.0.35 on 2026-05-26; `ai-v5` → 1.0.41) | VERIFIED | SELECTED |
| DeepSeek API (`api.deepseek.com`, `deepseek-chat`) | trusted | VERIFIED | SELECTED |

## Selected

- **`@ai-sdk/deepseek@ai-v5`** (resolves to `1.0.41`) + model id `"deepseek-chat"` for both `discoverPostUrls` and `extractPostFields`. Evidence: `.harness/deepseek-v4-web-discovery/probes/deepseek/probe.log`.

## Findings

### Usage shape (drives `extractDeepSeekUsage`)

The Vercel AI SDK normalises DeepSeek's response into its standard fields:

```json
{
  "inputTokens": 351,
  "outputTokens": 157,
  "totalTokens": 508,
  "cachedInputTokens": 256
}
```

- `cachedInputTokens` is the prefix-cache-hit portion of `inputTokens`. The `computeCallCost` math already subtracts this from `inputTokens` and prices it at `cacheReadPerMTok`, so the cache-hit discount flows through without any change to `cost.ts` math.
- No `cacheCreation5m/1hTokens` field — DeepSeek's prefix cache is auto-managed, no separately-billed write tier. Force these to `0` in the extractor.
- No `reasoningTokens` field on `deepseek-chat` (non-reasoning model). Force to `0`.

DeepSeek-native fields live under `providerMetadata.deepseek`:

```json
{ "promptCacheHitTokens": 256, "promptCacheMissTokens": 95 }
```

These are for debug only — `promptCacheHitTokens === cachedInputTokens`, and `promptCacheHitTokens + promptCacheMissTokens === inputTokens` (verified: 256 + 95 = 351). The extractor reads only the AI-SDK-standard top-level `usage` fields; no `providerMetadata` parsing needed.

### Cache behaviour

Two back-to-back identical calls observed:

| Call | `inputTokens` | `cachedInputTokens` | Cache hit rate |
|---|---|---|---|
| 1 (cold) | 351 | 0 | 0% |
| 2 (warm, same prompt) | 351 | 256 | 73% |

The 256-token cache hit on Call 2 confirms the 98%-discount-on-cached-portion economics described in the design doc are real and accessible from `@ai-sdk/deepseek`. Cache appears to span at least the system prompt prefix (256 of 351 tokens stayed identical).

### Structured output reliability

The discovery schema (`z.object({ posts: z.array(...) })`) parsed cleanly on both calls: 3 posts extracted, navigation skipped, `published_at` correctly normalised from "3 days ago" / "yesterday" / ISO date. No fallback to fallback-chain step 2 needed.

### Version pin correction

The design doc said "pin to `2.0.74` matching sibling providers." That's wrong for this package — `@ai-sdk/deepseek` has its own versioning history. The `ai-v5` dist-tag resolves to `1.0.41`, which is the version that targets `ai@5.x`. Spec must pin via the dist-tag or explicit `1.0.41`, not `2.0.74`.

## Setup Needed

- `DEEPSEEK_API_KEY` added to project-root `.env.harness` (already in place, verified gitignored).
- For the pipeline itself: add `DEEPSEEK_API_KEY=` to `.env` and `.env.example`. Remove `GEMINI_API_KEY` from required envs (no other pipeline path uses it).

## Pivot Log

(none — primary library verified on first probe)

## Verification stubs

See `verification/verification-stubs.md` — re-runs this exact probe at functional-verify time.

<!-- LP:VERDICT:PASS -->
