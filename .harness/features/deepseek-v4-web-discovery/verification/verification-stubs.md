# Verification Stubs — deepseek-v4-web-discovery

Stub VS entries folded by spec-generation into `spec.md` § Verification Scenarios. The same probe scripts are re-run by `functional-verify` at end of pipeline.

## VS-0-deepseek-discovery: Library probe — DeepSeek V4 Flash discovery call

**Type:** api
**Run:** `cd /media/aman/external/tmp/probe-deepseek-kRzinZ && node probe-discovery.mjs` (script also archived at `.harness/deepseek-v4-web-discovery/probes/deepseek/probe-discovery.mjs`)
**Pre-req:** `DEEPSEEK_API_KEY` exported from `.env.harness`.
**Expected:**
- Exit 0.
- Both calls return 3 posts matching the Zod discovery schema.
- Call 1: `usage.cachedInputTokens === 0`.
- Call 2 (same prompt within seconds): `usage.cachedInputTokens > 0`.
- `providerMetadata.deepseek.promptCacheHitTokens + promptCacheMissTokens === usage.inputTokens` on both calls.

This is the gate that proves the cache-hit pricing assumption (the headline economic claim of the design) holds against the live API at verify time.
