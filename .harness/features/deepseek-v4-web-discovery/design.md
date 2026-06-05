# Design — Switch web-collector LLM to DeepSeek V4 Flash

**Date:** 2026-05-28
**Spec:** `deepseek-v4-web-discovery`
**Status:** Draft

## Problem

The two LLM call sites in the web collector — `discoverPostUrls` and `extractPostFields` — currently run on `gemini-3.1-flash-lite` ($0.25 / $1.50 per MTok). DeepSeek V4 Flash is available with materially better economics for an identical workload: $0.14 input / $0.28 output (cache-miss) and **$0.0028 input on cache hits** (98% off), with the same 1 M-token context window the discovery prompt occasionally needs (`COMBINED_DISCOVERY_CAP = 120_000`, but listings can grow).

Both call sites are input-heavy structured-output generations (HTML → markdown → typed JSON via `generateObject`). They use byte-identical system prompts across thousands of source pages per day, so the prefix cache will hit often once warm — turning input cost into a near-zero rounding error after the first call per prompt prefix.

## Goals

1. Replace the model for both `discoverPostUrls` and `extractPostFields` with DeepSeek V4 Flash via `@ai-sdk/deepseek` (Vercel AI SDK first-party provider).
2. Update the cost-tracker pricing table + usage extractor dispatcher so per-run `cost_breakdown` correctly attributes cache-miss input, **cache-hit input**, and output tokens at the new rates.
3. Keep the change a drop-in: same `generateObject` call shape, same Zod schemas, no behavioural change to the discovery/extraction outputs other than provider.
4. Update env vars (`DEEPSEEK_API_KEY` replaces `GEMINI_API_KEY` for this path; `GEMINI_API_KEY` is no longer required for any pipeline path).

## Non-goals

- Switching shortlist / rerank / recap / digest — those remain on Anthropic Claude Haiku.
- Adding a model-selection knob or env override. The web collector model is hard-coded by design (single tested-good model per stage).
- Tuning the discovery / extraction prompts. Same prompts, different provider.
- Backfilling old `cost_breakdown` rows. Historical Gemini pricing stays correct for past runs; new runs price under DeepSeek.

## Approach

### Call sites (one file)

`packages/pipeline/src/collectors/web.ts`:

- Change `WEB_COLLECTOR_MODEL_ID` from `"gemini-3.1-flash-lite"` → `"deepseek-chat"`. DeepSeek's API uses a single rolling alias `deepseek-chat` that always points at the current non-reasoning flagship; with V4 released, this resolves to V4 Flash. (Confirmed in library-probe stage.)
- Replace `resolveDefaultModel` body:
  ```ts
  const { createDeepSeek } = await import("@ai-sdk/deepseek");
  const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
  cachedDefaultModel = deepseek(WEB_COLLECTOR_MODEL_ID);
  ```
- Module-cached `cachedDefaultModel` is preserved (the credential is process-env, not admin-mutable, so the existing once-per-process cache is correct — no spec freshness promise to break).

### Pricing + usage extraction (shared)

`packages/shared/src/pricing.ts`:

- Add a `MODEL_PRICING["deepseek-chat"]` entry with the V4 Flash rates:
  - `inputPerMTok: 0.14` (cache-miss)
  - `outputPerMTok: 0.28`
  - `cacheReadPerMTok: 0.0028` (the 98%-off prefix-cache hit rate)
  - `cacheWrite5mPerMTok: 0` (DeepSeek's cache is automatic; there is no separately-billed write tier — writes are free, only reads are discounted)
  - `cacheWrite1hPerMTok: 0`
- Keep the existing `"gemini-3.1-flash-lite"` entry intact so legacy `cost_breakdown` rows still price correctly when re-rendered.

`packages/shared/src/cost.ts`:

- Add a dispatcher branch `if (modelId.startsWith("deepseek-")) return extractDeepSeekUsage(usage);`
- New `extractDeepSeekUsage(usage)` reads only the AI-SDK-standard fields:
  - `inputTokens` (total input)
  - `cachedInputTokens` (the prefix-cache-hit portion)
  - `outputTokens`
  - Forces Anthropic-only fields (`cacheCreation5m/1hTokens`, `reasoningTokens`) to 0.
  - Mirrors the existing `extractGeminiUsage` shape.
- The `computeCallCost` math is already cache-aware (it subtracts `cachedInputTokens` from `inputTokens` and prices them at `cacheReadPerMTok`), so no change needed there.

### Dependency

Add `@ai-sdk/deepseek` to `packages/pipeline/package.json` **only** (not shared/api/web). Pin to the **exact** version matching the existing sibling providers — `@ai-sdk/anthropic@2.0.74` and `@ai-sdk/google@2.0.74` — so we stay on the `ai-v5` line. Install via `pnpm add @ai-sdk/deepseek@ai-v5 --save-exact --filter @newsletter/pipeline` (or pin the exact `2.0.74` if the `ai-v5` dist-tag has rolled past that point). Verify with `pnpm typecheck` immediately after install per the `ai-sdk-provider-version-must-match-ai-major` learning.

### Env / docs

- `.env.example` + `.env`: add `DEEPSEEK_API_KEY=`; remove `GEMINI_API_KEY` (no other pipeline path uses it).
- `CLAUDE.md` (root + `packages/pipeline/CLAUDE.md` + `packages/shared/CLAUDE.md`): update every reference to "gemini-3.1-flash-lite" / `@ai-sdk/google` / `GEMINI_API_KEY` in the web-collector context to DeepSeek V4 Flash / `@ai-sdk/deepseek` / `DEEPSEEK_API_KEY`. Update the `MODEL_PRICING` documentation line.
- Required-env-vars list in root CLAUDE.md replaces `GEMINI_API_KEY` with `DEEPSEEK_API_KEY`.

### Tests

- Existing `packages/pipeline/tests/unit/collectors/web.test.ts` block "Phase 2: default provider built from @ai-sdk/google keyed by GEMINI_API_KEY (REQ-003)" must be updated to assert `@ai-sdk/deepseek` + `DEEPSEEK_API_KEY` + model id `"deepseek-chat"`.
- Add a pricing-table cost-math test for the DeepSeek entry: round-trip a realistic usage shape captured from the library-probe (input=N, cachedInput=M, output=K) and assert the computed USD matches the hand-calculation across all three token classes — including the cache-hit rate (this is the headline economic claim and must be regression-protected).
- The `MODEL_PRICING` rate values themselves should also be asserted at unit-test level: input=0.14, output=0.28, cache-read=0.0028, write tiers=0. If any of these change accidentally, the test fails.
- E2E test (live API call gated by `DEEPSEEK_API_KEY`): run one real `discoverPostUrls` call against a known small HTML listing fixture; assert the structured-output contract holds and `cost_breakdown.stages["web-discovery"]` carries a non-zero `byModel["deepseek-chat"]` row with `costStatus: "ok"`.

## External Dependencies & Fallback Chain

Per the `library-probe` skill's contract, the design declares its third-party surface and a fallback chain so a failed probe has a documented next step.

| Library / Service | Used for | Probe target |
|---|---|---|
| `@ai-sdk/deepseek` (npm) | Vercel AI SDK provider for DeepSeek | Verify the package resolves at the pinned version against `ai@5.0.169`; verify it exports `createDeepSeek` and the returned model satisfies `LanguageModel`. |
| DeepSeek API (`api.deepseek.com`) | LLM inference for web discovery + extraction | Live `generateObject` call using a small HTML fixture; capture the raw `usage` + `providerMetadata` shape so the cost-tracker extractor mirrors real field names exactly. |
| DeepSeek `deepseek-chat` model id | Currently maps to V4 Flash (DeepSeek's rolling alias for the latest non-reasoning model) | Verify the call succeeds, returns valid JSON matching the schema, and the usage shape includes a `cachedInputTokens` field (or the equivalent prefix-cache signal) when the same prompt is run twice. |

**Fallback chain** (if the primary fails the probe):

1. **Primary:** `@ai-sdk/deepseek` + `deepseek-chat` (= V4 Flash). 1 M context. Cheapest cache-hit input in the table.
2. **Fallback 1:** Pin to the explicit `deepseek-v4-flash` model id if the rolling `deepseek-chat` alias proves unstable in the probe (silently shifts target). Same cost, same provider, more deterministic.
3. **Fallback 2:** Revert to `@ai-sdk/google` + `gemini-2.5-flash-lite` ($0.10 / $0.40, 1 M context). Strictly cheaper than current `gemini-3.1-flash-lite` so even the fallback is a cost improvement. Re-uses the existing `@ai-sdk/google` install + `GEMINI_API_KEY`.
4. **Fallback 3 (escalate):** AskUserQuestion. Don't silently downgrade further.

## Risks

- **Rolling-alias surprise.** `deepseek-chat` is a moving target; the day DeepSeek ships V5 it changes meaning. Mitigation: the cost-tracker entry is keyed by the model id string returned at call time, not by our constant. If the API ever starts returning a different id, the cost rows fall through to `costStatus: "partial-unknown-model"` and the dashboard surfaces it — we don't silently misprice. We can choose at that point whether to pin the explicit version or update the pricing table.
- **Cache-hit assumption.** The 98%-off win depends on the prefix actually being cached. If discovery prompts vary on every call (e.g. we accidentally interpolate a per-call timestamp into the system prompt), the cache never hits and the input cost is the full $0.14 rate. The current `discoverPostUrls` prompt includes `Today is ${today}` — that's a daily-stable variable, but the cache window is shorter than 24h, so the cache will warm fresh each morning and amortize through the day's discovery runs. This is acceptable; no prompt rewrite needed.
- **`usage` field-name skew.** DeepSeek's response shape may use snake_case (`prompt_cache_hit_tokens`) or a different field name than `cachedInputTokens`. The library-probe **must** capture the live shape before spec-gen freezes the extractor.
- **`generateObject` JSON-mode reliability.** DeepSeek supports structured output but historically has been less strict than Gemini/Anthropic. If the probe shows JSON-parse errors on the discovery schema (which has nested arrays), we'll fall back to fallback-chain step 2 (explicit V4 Flash pin) before considering the Google fallback.

## Out of scope

- Adding configurability so the web-collector model can be admin-changed at `/admin/settings`.
- Migrating any other LLM stage off Anthropic.
- Rewriting prompts to improve cache-hit rate beyond what's already there.
