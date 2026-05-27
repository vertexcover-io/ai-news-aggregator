# SPEC: Cheaper Provider/Model for Web Discovery + Extraction

**Source:** docs/spec/cheaper-discovery-extraction/design.md
**Generated:** 2026-05-27
**Library probe:** docs/spec/cheaper-discovery-extraction/library-probe.md (VERDICT: PASS)

## Summary

Move the web collector's two LLM call sites — `discoverPostUrls` (find post URLs/titles/dates from a listing) and `extractPostFields` (extract title/author/date/image from a post page) — from Anthropic Claude Haiku 4.5 (`@ai-sdk/anthropic`, $1.00/$5.00 per MTok) to **Gemini 3.1 Flash-Lite** (`@ai-sdk/google@2.0.74`, `gemini-3.1-flash-lite`, $0.25/$1.50 per MTok). Update cost tracking so the new stages price correctly via a provider-aware usage extractor and a new pricing-table entry. The other three LLM call sites (`shortlist`, `rerank`, `generateRecap`) and the entire Anthropic cost path are untouched.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The web collector shall use the Google Generative AI provider (`@ai-sdk/google`) with model id `gemini-3.1-flash-lite` for the discovery LLM call. | `WEB_COLLECTOR_MODEL_ID === "gemini-3.1-flash-lite"`; the default model in `web.ts` is created via `createGoogleGenerativeAI(...)`, not `anthropic(...)`. Unit test asserts `discoverPostUrls` is invoked with a Google-provider model and the model id recorded to the tracker is `gemini-3.1-flash-lite`. | Must |
| REQ-002 | Ubiquitous | The web collector shall use `gemini-3.1-flash-lite` via the Google provider for the extraction LLM call. | `extractPostFields` records `modelId: "gemini-3.1-flash-lite"` to the tracker; unit test asserts the model passed is the Google-provider model. | Must |
| REQ-003 | Ubiquitous | The Google provider shall read its API key from the `GEMINI_API_KEY` environment variable. | `resolveDefaultModel` (or equivalent) calls `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })`. Unit test asserts the provider factory receives the `GEMINI_API_KEY` value. | Must |
| REQ-004 | Event-driven | When a discovery or extraction call completes, the system shall record its token usage under the existing `web-discovery` / `web-extraction` cost stages with `modelId: "gemini-3.1-flash-lite"`. | After a collect run (or unit-level `reportUsage` call), `cost_breakdown.stages["web-discovery"].byModel[0].modelId === "gemini-3.1-flash-lite"`; same for `web-extraction`. | Must |
| REQ-005 | Ubiquitous | The pricing table shall contain a `gemini-3.1-flash-lite` entry: input $0.25/MTok, output $1.50/MTok, cache-read $0.025/MTok, cache-write 5m $0/MTok, cache-write 1h $0/MTok. | `MODEL_PRICING["gemini-3.1-flash-lite"]` equals `{ inputPerMTok: 0.25, outputPerMTok: 1.5, cacheReadPerMTok: 0.025, cacheWrite5mPerMTok: 0, cacheWrite1hPerMTok: 0 }`. Unit test asserts exact values. | Must |
| REQ-006 | Event-driven | When usage is extracted for a Gemini model, the system shall read only the standard AI SDK usage fields (`inputTokens`, `outputTokens`, `cachedInputTokens`) and shall set the Anthropic-only cache-creation tiers (`cacheCreation5mTokens`, `cacheCreation1hTokens`) and `reasoningTokens` to 0. | `extractUsage("gemini-3.1-flash-lite", { inputTokens: 147, outputTokens: 191, totalTokens: 338 }, { google: {...} })` returns `{ inputTokens:147, outputTokens:191, cachedInputTokens:0, cacheCreation5mTokens:0, cacheCreation1hTokens:0, reasoningTokens:0 }`. Built from the live probe `payload.sample.json`. | Must |
| REQ-007 | Event-driven | When usage is extracted for a non-Gemini (Anthropic) model, the system shall use the existing Anthropic extraction (reading `providerMetadata.anthropic.usage.cache_creation` ephemeral tiers) unchanged. | `extractUsage("claude-haiku-4-5-20251001", usage, anthropicMeta)` returns identical output to the pre-change `extractAnthropicUsage(usage, anthropicMeta)` for a fixture with non-zero cache-creation tiers. | Must |
| REQ-008 | Event-driven | When `computeCallCost` prices a `gemini-3.1-flash-lite` call, the USD result shall equal `(inputTokens·0.25 + outputTokens·1.5 + cachedInputTokens·0.025) / 1_000_000`. | For `{inputTokens:1_000_000, outputTokens:1_000_000, cachedInputTokens:0, ...}` → `costUsd === 1.75`. For the live probe discovery sample `{147,191}` → `costUsd ≈ (147·0.25 + 191·1.5)/1e6 = 0.0003204`. Unit test asserts within 1e-9. | Must |
| REQ-009 | Ubiquitous | `@ai-sdk/google@2.0.74` shall be a dependency of `@newsletter/pipeline` only (not shared/api/web), pinned to an exact version. | `packages/pipeline/package.json` dependencies contains `"@ai-sdk/google": "2.0.74"` (no `^`/`~`); it does not appear in other packages' package.json. | Must |
| REQ-010 | Ubiquitous | The `shortlist`, `rerank`, and `generateRecap` call sites shall continue to use their existing Anthropic models and existing cost recording. | Diff shows no model-id or provider change in `shortlist.ts`, `rank.ts`, `recap.ts`. Their unit/e2e tests pass unchanged. | Must |
| REQ-011 | Ubiquitous | `GEMINI_API_KEY` shall be documented in the committed `.env.example` and in CLAUDE.md's required/optional env list. | `.env.example` contains a `GEMINI_API_KEY=` line; CLAUDE.md "Required env vars" paragraph mentions `GEMINI_API_KEY` for the web collector. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Gemini response omits `cachedInputTokens` entirely (observed in probe). | `extractUsage` reads `usage.cachedInputTokens ?? 0` → `cachedInputTokens = 0`; no crash; cost computed from input/output only. | REQ-006, REQ-008 |
| EDGE-002 | A run mixes Gemini (discovery/extraction) and Anthropic (rank/recap) stages. | `totalCostUsd` sums both providers; `stages` has gemini model id under web-* and anthropic model ids under rank/recap; `unknownModels` is empty. | REQ-004, REQ-007, REQ-010 |
| EDGE-003 | Pricing entry for `gemini-3.1-flash-lite` is somehow absent at runtime (defensive). | `computeCallCost` returns `costUsd: null`; stage `costStatus` becomes `all-unknown-model`/`partial-unknown-model`; model id added to `unknownModels`; run does not crash. (Existing behavior — must remain true.) | NFR1 |
| EDGE-004 | Archives created before this change persisted Anthropic model ids in `cost_breakdown`. | Adding the Gemini pricing entry does not remove Anthropic entries; historical cost breakdowns still price/render correctly. | REQ-005, REQ-007 |
| EDGE-005 | `GEMINI_API_KEY` is unset/empty at runtime. | The Gemini provider call fails; the web collector's existing per-source `Promise.allSettled` error handling records the source as failed and the run continues with other sources. No new behavior; no unhandled rejection. | REQ-003 |
| EDGE-006 | Gemini transiently returns "Your project has been denied access" (observed once in probe). | Treated as a per-source failure by existing collector error handling; run continues. No new retry logic introduced by this feature. | REQ-001, REQ-002 |
| EDGE-007 | A Gemini call reports `cachedInputTokens > 0` (implicit cache hit). | `extractUsage` carries it through; `computeCallCost` prices it at cacheReadPerMTok ($0.025/MTok). | REQ-006, REQ-008 |

## Verification Matrix

| REQ/EDGE ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | web.ts model id + provider factory |
| REQ-002 | Yes | No | No | No | |
| REQ-003 | Yes | No | No | No | provider reads GEMINI_API_KEY |
| REQ-004 | Yes | No | Yes | No | E2E: cost-tracking e2e records gemini model id for web stages (extend existing cost-tracking.e2e or web collector test) |
| REQ-005 | Yes | No | No | No | pricing table exact values |
| REQ-006 | Yes | No | No | No | extractUsage gemini branch; fixture from probe payload.sample.json |
| REQ-007 | Yes | No | No | No | extractUsage anthropic branch unchanged |
| REQ-008 | Yes | No | No | No | computeCallCost numeric assertion |
| REQ-009 | Yes | No | No | No | package.json assertion / build passes |
| REQ-010 | Yes | No | No | No | unchanged stages — existing tests stay green |
| REQ-011 | No | No | No | Yes | doc files inspected in review |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | Yes | No | No | No | mixed-provider snapshot |
| EDGE-003 | Yes | No | No | No | unknown-model path (existing behavior preserved) |
| EDGE-004 | Yes | No | No | No | anthropic pricing entries still present |
| EDGE-005 | No | No | No | Yes | covered by existing collector error handling; documented |
| EDGE-006 | No | No | No | Yes | operational note from probe |
| EDGE-007 | Yes | No | No | No | cachedInputTokens carry-through |

## Verification Scenarios (VS-0 — folded from library-probe)

### VS-0-ai-sdk-google-discovery: Library probe — @ai-sdk/google discovery
**Type:** api
**Run:** `cd packages/pipeline && GEMINI_API_KEY=<from .env.harness> node "$(git rev-parse --show-toplevel)/.harness/cheaper-discovery-extraction/probes/ai-sdk-google/probe.mjs"`
**Expected:** exit 0; stdout `DISCOVERY ok — posts: 3`; `payload.sample.json` `discovery.posts` non-empty array of `{url,title,published_at}`.

### VS-0-ai-sdk-google-extraction: Library probe — @ai-sdk/google extraction
**Type:** api
**Run:** (same probe script — runs both flows)
**Expected:** exit 0; stdout `EXTRACTION ok — title:`; `payload.sample.json` `extraction.fields` has non-empty `title`,`author`,`published_at`,`image_url`.

### VS-0-ai-sdk-google-usage-shape: Library probe — Gemini usage shape
**Type:** api
**Run:** (same probe script)
**Expected:** `result.usage` = `{ inputTokens, outputTokens, totalTokens }` with NO `cachedInputTokens`/`reasoningTokens` keys; `result.providerMetadata.google` present with no usage/cache subfields. This is the exact shape REQ-006's Gemini extractor must handle.

## Out of Scope

- Changing the model/provider for `shortlist`, `rerank`, or `generateRecap` (those stay on Anthropic).
- Making the web-collector model env-overridable (decision: hardcoded constant swap — see design Approach A; the constant is `WEB_COLLECTOR_MODEL_ID` in `web.ts`).
- Introducing a `GOOGLE_GENERATIVE_AI_API_KEY` env var (we reuse the existing `GEMINI_API_KEY` by wiring the provider explicitly).
- Adding retry/backoff logic for transient Gemini errors (existing per-source `Promise.allSettled` handling is sufficient).
- A central provider/model config module (design Approach C — deferred as a future refactor).
- Historical backfill of `cost_breakdown` for archives created before this change.
- Any change to public archive routes' cost serialization (cost remains admin-only — unchanged invariant).
- Removing the unused leftover `GEMINI_API_KEY` comment in `.env` or reconciling the broken `.env.example` self-symlink in the local checkout (out of scope; only the committed `.env.example` content is updated).
