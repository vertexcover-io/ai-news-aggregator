# Cheaper Provider/Model for Web Discovery + Extraction

**Final verification verdict:** ✅ **PASS** — see [verification/proof-report.md](verification/proof-report.md)
**Quality gate:** PASS · **Code review:** APPROVE (2-pass)
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/217

## Summary

The web collector's two LLM call sites — `discoverPostUrls` (find post URLs/titles/dates from a listing page) and `extractPostFields` (extract title/author/date/image from a post page) — moved from Anthropic **Claude Haiku 4.5** ($1.00/$5.00 per MTok) to **Gemini 3.1 Flash-Lite** (`gemini-3.1-flash-lite`, $0.25/$1.50 per MTok — ~4× cheaper input, ~3.3× cheaper output) via the `@ai-sdk/google` provider. These are simple structured-output tasks, so the cheaper Flash-Lite tier handles them with no quality loss (verified live).

Cost analysis was updated to match: a `gemini-3.1-flash-lite` entry was added to the pricing table, and usage extraction became **provider-aware** — a new `extractUsage(modelId, usage, providerMetadata)` dispatcher routes `gemini-*` ids to a Gemini extractor (standard token fields only; Anthropic-specific cache-creation tiers forced to 0) and all other ids to the **unchanged** `extractAnthropicUsage`. The other three LLM call sites (`shortlist`, `rerank`, `generateRecap`) and the entire Anthropic cost path are untouched.

## What changed

- `packages/shared/src/pricing.ts` — `gemini-3.1-flash-lite` pricing entry (input 0.25, output 1.5, cache-read 0.025, cache-write tiers 0).
- `packages/shared/src/cost.ts` — `extractGeminiUsage` + `extractUsage` dispatcher; `extractAnthropicUsage` unchanged.
- `packages/pipeline/src/collectors/web.ts` — `WEB_COLLECTOR_MODEL_ID = "gemini-3.1-flash-lite"`; `resolveDefaultModel` builds the model via `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })`.
- `packages/pipeline/src/services/cost-tracker.ts` — `record()` now calls `extractUsage(input.modelId, …)`.
- `packages/pipeline/package.json` — `@ai-sdk/google@2.0.74` (pinned; matches `ai@5.0.169` / `@ai-sdk/anthropic@2.0.74` via the `ai-v5` dist-tag).
- `.env.example` + `CLAUDE.md` (root + pipeline + shared) — document `GEMINI_API_KEY` and the new model/provider.

> **Repo-state note for the reviewer:** the tracked `.env.example` was a **broken self-referential symlink** on `main` (it resolved to itself → `ELOOP`). This PR restores it to a real regular file with the canonical placeholder content (no real secrets) plus the new `GEMINI_API_KEY=` line. The git diff therefore shows a type-change (`120000` symlink → `100644` file). If the symlink was intentional, reconcile at merge.

## Library probe

- **Selected:** `@ai-sdk/google@2.0.74` + `gemini-3.1-flash-lite`. Verdict: **PASS**.
- **Alternatives in the fallback chain (not needed):** Gemini 2.5 Flash-Lite → Gemini 3 Flash Preview → stay on Anthropic Haiku.
- 3/3 live use cases verified (discovery, extraction, usage-shape). One transient "denied access" on first call; all re-runs OK — documented as a known Google-side transient, handled by the collector's existing per-source error isolation.

## Reviewer index

| Artifact | What it is |
|---|---|
| [design.md](design.md) | Brainstorm output — problem, approaches, chosen design, fallback chain |
| [spec.md](spec.md) | EARS requirements (REQ-001..011), edge cases (EDGE-001..007), verification matrix, VS-0 scenarios |
| [plan.md](plan.md) | 3-phase implementation plan + DOT phase graph + codebase context |
| [library-probe.md](library-probe.md) | `@ai-sdk/google` trust-gate evidence (health + live smoke + usage shape) |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify verdict (the gate output) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap pass — scenarios attempted + defects |
| [verification/verification-stubs.md](verification/verification-stubs.md) | VS-0 probe scenarios folded into the spec |
| [learnings.md](learnings.md) | Task-specific learnings (if present) |

## Cost impact (illustrative)

Per the live probe sample, a discovery call of 147 input / 191 output tokens now costs **$0.00032325** on Gemini 3.1 Flash-Lite vs **$0.001102** on Haiku — a ~3.4× reduction on this call. Aggregate savings scale with the web-collector's discovery + extraction volume across all blog sources.
