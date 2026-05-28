# Functional Verification — proof-report.md

**Spec:** deepseek-v4-web-discovery · **Run:** 2026-05-28 13:14 · **Verdict:** PASS

This report proves each Verification Scenario from `spec.md § 5` against live or test evidence. The feature has no UI surface — no `type:"ui"` claims exist in `claims.json`, so the Playwright MCP gate is not applicable here. All 17 claims are `unit` / `api` / `docs`.

## VS-0-deepseek-discovery — Live DeepSeek API probe

**Type:** api · **Status:** PASS · **Evidence:** `.harness/deepseek-v4-web-discovery/probes/deepseek/probe-discovery.mjs` re-run at verify time.

Two-call output:
```
CALL 1: {"inputTokens":351,"outputTokens":157,"totalTokens":508,"cachedInputTokens":256}
CALL 2: {"inputTokens":351,"outputTokens":157,"totalTokens":508,"cachedInputTokens":256}
providerMetadata.deepseek call 1: {"promptCacheHitTokens":256,"promptCacheMissTokens":95}
providerMetadata.deepseek call 2: {"promptCacheHitTokens":256,"promptCacheMissTokens":95}
```

Sum-check `promptCacheHitTokens + promptCacheMissTokens === inputTokens` (256 + 95 = 351) verified for both calls. Three posts parsed cleanly against the Zod discovery schema. Process-boundary-spanning cache: both calls hit cache (prompt was already cached from the earlier library-probe run minutes earlier, well within DeepSeek's prefix-cache TTL). Strengthens the headline economic claim — caching survives across process restarts within the window, not just intra-process.

## VS-1 — Default-model factory uses DeepSeek

**Type:** unit · **Status:** PASS · **Evidence:** `pnpm --filter @newsletter/pipeline test:unit` ⇒ 1040/1040 passing. The Phase-2 block in `packages/pipeline/tests/unit/collectors/web.test.ts` (renamed from the Gemini equivalent) asserts `WEB_COLLECTOR_MODEL_ID === "deepseek-chat"`, mocks `@ai-sdk/deepseek`, and verifies `createDeepSeek({ apiKey: "test-deepseek-key-123" })` is called.

## VS-2 — Pricing-table entry is exact

**Type:** unit · **Status:** PASS · **Evidence:** `packages/shared/tests/unit/pricing.test.ts` "deepseek-chat rates match design values" deep-equals the exact five-field shape `{ inputPerMTok: 0.14, outputPerMTok: 0.28, cacheReadPerMTok: 0.0028, cacheWrite5mPerMTok: 0, cacheWrite1hPerMTok: 0 }`. The preserved `gemini-3.1-flash-lite` entry test also still passes (REQ-008).

## VS-3 — Cost math round-trip from probe sample

**Type:** unit · **Status:** PASS · **Evidence:** `packages/shared/tests/unit/cost.test.ts` REQ-017 round-trip:
- `extractUsage("deepseek-chat", {inputTokens:351, outputTokens:157, cachedInputTokens:256})` returns `{inputTokens:95, outputTokens:157, cachedInputTokens:256, cacheCreation5m:0, cacheCreation1h:0, reasoning:0}` (the `inputTokens` field is normalised to the cache-miss portion per the code-review pass-1 fix to prevent double-billing).
- `computeCallCost(extracted, "deepseek-chat")` returns `0.00005797680` (matches hand-calc `95/1e6 * 0.14 + 256/1e6 * 0.0028 + 157/1e6 * 0.28`).

Note: The spec's VS-3 stated `0.00005732168` — that was a transcription error in the spec. The implementation and test use the correct value `0.00005797680`. Spec will be amended in sync-docs.

## VS-4 — End-to-end cost-breakdown attribution

**Type:** e2e · **Status:** COVERED_BY_UNIT · **Evidence:** No e2e test was added (cost-tracker integration is exercised via existing `cost-tracker.test.ts` unit tests that thread `tracker.record({stage:"web-discovery", modelId:"deepseek-chat", usage, providerMetadata})` through `extractUsage` and verify the byModel/costStatus shape). A real run with a live blog source would prove the full chain — deferred to the operator's first manual run-now after deploy, as Stage-5 doesn't have access to the prod web sources.

## VS-5 — Build + typecheck + lint clean

**Type:** ci · **Status:** PASS · **Evidence:**
- `pnpm typecheck`: 7/7 tasks, FULL TURBO (cached after dirty runs validated).
- `pnpm lint`: 5/5 tasks, FULL TURBO (0 errors, 17 warnings = baseline).
- `pnpm --filter @newsletter/pipeline test:unit`: 90 files, 1040/1040 passing in 18.32s.
- `pnpm --filter @newsletter/shared test:unit`: 32 files, 329/329 passing in 1.27s (was 324 on baseline; +5 net new tests covering DeepSeek pricing + cost math).

## VS-6 — Env / docs alignment

**Type:** docs · **Status:** PASS · **Evidence:** Grep audit:
```
$ grep -rn "GEMINI_API_KEY\|@ai-sdk/google" packages/ .github/ deployment/
(only matches: preserved MODEL_PRICING["gemini-3.1-flash-lite"] entry and its REQ-008 regression test — expected per spec REQ-008)
```
- `.env.example`: `DEEPSEEK_API_KEY=` present, no `GEMINI_API_KEY=` line.
- `deployment/.env.prod.example`: `DEEPSEEK_API_KEY=REPLACE_ME` with updated comment.
- `.github/workflows/deploy.yml`: `DEEPSEEK_API_KEY` in both the `env:` block (line 118) and the required[] Python list (line 159).
- Root `CLAUDE.md`, `packages/pipeline/CLAUDE.md`, `packages/shared/CLAUDE.md`: all web-collector references updated to DeepSeek; legacy Gemini pricing entry reference clarified as "kept for backwards compatibility".

## Adversarial findings

See `verification/adversarial-findings.md`.

## Operator action required before next prod run

- Add `DEEPSEEK_API_KEY` to GitHub Environment secrets (`production`).
- Add `DEEPSEEK_API_KEY=<key>` to the main checkout's `.env` (symlinked by the worktree; we did not edit it). Remove the now-unused `GEMINI_API_KEY=...` line from `.env`.
