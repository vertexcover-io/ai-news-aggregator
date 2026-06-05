# Verification Stubs (from library-probe)

Spec-generation appends these to the spec's `## Verification Scenarios`.
Functional-verify re-runs them at the end of the pipeline.

### VS-0-vercel-ai-sdk-usage-shape: Vercel AI SDK usage shape still matches `extractAnthropicUsage`
**Type:** live API probe
**Run:**
```bash
cd packages/pipeline
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY' ../../.env | cut -d= -f2-) \
  pnpm tsx ../../docs/spec/admin-pipeline-cost-analysis/probes/usage-shape.mjs
```
**Expected:**
- exit 0
- `result.usage` contains keys `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens` (all numbers)
- `result.providerMetadata.anthropic.usage.cache_creation` contains both `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` (both numbers)
- `result.providerMetadata.anthropic.cacheCreationInputTokens` is a number
**Why this matters:** if the SDK ever renames or moves a field, `extractAnthropicUsage` silently returns zeros and we under-bill. This probe catches drift before the gate.
