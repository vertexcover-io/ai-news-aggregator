# DeepSeek V4 Flash — web-collector LLM swap

**Verdict:** [PASS](./verification/proof-report.md) · **Status:** Approved · **Date:** 2026-05-28

## Summary

Replaces the LLM driving the two web-collector call sites (`discoverPostUrls` and `extractPostFields` in `packages/pipeline/src/collectors/web.ts`) from `gemini-3.1-flash-lite` (via `@ai-sdk/google`) to `deepseek-chat` = DeepSeek V4 Flash (via `@ai-sdk/deepseek`). Updates the cost-tracker pricing table + extractor for the new model. Materially better economics — 64% off output, 98% off cache-hit input — at the same 1M context window.

While doing the swap, fixed a pre-existing **cache-double-billing bug** in `computeCallCost` that had silently inflated Gemini cost numbers since the Gemini integration shipped. The fix is in the extractor (subtracts `cachedInputTokens` from `inputTokens` before billing); the formula is unchanged.

## Artifacts

| Document | Purpose |
|---|---|
| [`design.md`](./design.md) | Problem, goals, approach, fallback chain |
| [`library-probe.md`](./library-probe.md) | Live `@ai-sdk/deepseek` verification — VERIFIED |
| [`spec.md`](./spec.md) | EARS requirements (REQ-001..REQ-017), constraints, verification scenarios |
| [`plan.md`](./plan.md) | Single-phase 9-step TDD plan |
| [`verification/proof-report.md`](./verification/proof-report.md) | Final verification gate — PASS |
| [`verification/adversarial-findings.md`](./verification/adversarial-findings.md) | 8 adversarial scenarios attempted, 0 new defects |

## Library probe verdict

- **Selected:** `@ai-sdk/deepseek@ai-v5` (resolves to `1.0.41`) + model id `"deepseek-chat"`
- **Alternatives in fallback chain (not exercised):** `deepseek-v4-flash` explicit pin, `gemini-2.5-flash-lite`
- **Live cache hit verified:** call 2 returned `cachedInputTokens: 256` out of 351 (73% hit) — proves the 98%-off pricing is real and accessible from the AI SDK

## Operator action required before deploy

1. Add `DEEPSEEK_API_KEY` to GitHub Environment secrets (`production`).
2. Add `DEEPSEEK_API_KEY=<key>` to the main checkout's `.env`; remove the now-unused `GEMINI_API_KEY=...` line.

## PR

(filled in after Stage 6 push.)
