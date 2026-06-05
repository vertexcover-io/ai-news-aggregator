# Verification Stubs (VS-0) — folded into spec.md by spec-generation

### VS-0-ai-sdk-google-discovery: Library probe — @ai-sdk/google discovery
**Type:** api
**Run:** `cd packages/pipeline && GEMINI_API_KEY=<from .env.harness> node "$(git rev-parse --show-toplevel)/.harness/cheaper-discovery-extraction/probes/ai-sdk-google/probe.mjs"`
**Expected:** exit 0; stdout contains `DISCOVERY ok — posts: 3`; `payload.sample.json` `discovery.posts` non-empty array of `{url,title,published_at}`.

### VS-0-ai-sdk-google-extraction: Library probe — @ai-sdk/google extraction
**Type:** api
**Run:** (same probe script — runs both flows)
**Expected:** exit 0; stdout contains `EXTRACTION ok — title:`; `payload.sample.json` `extraction.fields` has non-empty string `title`, `author`, `published_at`, `image_url`.

### VS-0-ai-sdk-google-usage-shape: Library probe — Gemini usage shape
**Type:** api
**Run:** (same probe script)
**Expected:** `result.usage` is `{ inputTokens, outputTokens, totalTokens }` with NO `cachedInputTokens`/`reasoningTokens` keys; `result.providerMetadata.google` present with no usage/cache subfields. This is the shape the Gemini cost extractor must read (input/output only; everything else defaults to 0; `cachedInputTokens ?? 0`).
