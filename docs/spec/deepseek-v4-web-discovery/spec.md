# SPEC — deepseek-v4-web-discovery

**Status:** Approved · **Date:** 2026-05-28 · **Design:** [design.md](./design.md) · **Probe:** [library-probe.md](./library-probe.md)

## 1. Overview

Replace the web collector's LLM (currently `gemini-3.1-flash-lite` via `@ai-sdk/google`) with `deepseek-chat` (DeepSeek V4 Flash) via `@ai-sdk/deepseek`. Update the cost-tracker pricing table and usage-extractor dispatcher to price the new model correctly, including the 98%-off prefix-cache-hit input rate verified live in the probe.

Scope is two LLM call sites in one file plus a pricing/extractor entry in shared, plus env + docs updates. No prompt changes, no schema changes, no behavioural changes to discovery/extraction outputs.

## 2. Requirements (EARS)

### Provider swap

- **REQ-001** While the web collector resolves its default model, the system shall construct it via `createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })` and return `deepseek("deepseek-chat")`.
- **REQ-002** The exported constant `WEB_COLLECTOR_MODEL_ID` shall equal `"deepseek-chat"`.
- **REQ-003** When the existing `WebCollectorDeps.llmModel` injection is provided by a caller (tests), the system shall use the injected model and skip the default-model resolver — preserving current dependency-injection behaviour byte-for-byte.

### Cost tracking

- **REQ-004** `MODEL_PRICING` shall include an entry keyed `"deepseek-chat"` with exactly these rates per million tokens: `inputPerMTok: 0.14`, `outputPerMTok: 0.28`, `cacheReadPerMTok: 0.0028`, `cacheWrite5mPerMTok: 0`, `cacheWrite1hPerMTok: 0`.
- **REQ-005** The `extractUsage` dispatcher in `@newsletter/shared/cost` shall route any `modelId` starting with `"deepseek-"` to a new `extractDeepSeekUsage` extractor.
- **REQ-006** `extractDeepSeekUsage` shall read `usage.inputTokens`, `usage.outputTokens`, `usage.cachedInputTokens` (defaulting `cachedInputTokens` to 0 when absent) and shall set `cacheCreation5mTokens`, `cacheCreation1hTokens`, and `reasoningTokens` to `0` — mirroring the shape captured in `payload.sample.json`.
- **REQ-007** When a run's `cost_breakdown.stages["web-discovery"]` or `cost_breakdown.stages["web-extraction"]` is computed, the system shall produce a `byModel` row keyed `"deepseek-chat"` with `costStatus: "ok"` and a non-null `costUsd` value derived from the rates in REQ-004.
- **REQ-008** Legacy archives whose `cost_breakdown` references `"gemini-3.1-flash-lite"` shall continue to price correctly via the preserved Gemini entry in `MODEL_PRICING` (no removal, no rename).

### Dependency

- **REQ-009** `packages/pipeline/package.json` shall declare `"@ai-sdk/deepseek"` at the exact resolved version of the `ai-v5` dist-tag (currently `1.0.41`) — pinned, no `^`/`~`.
- **REQ-010** The package shall be added to `packages/pipeline` only — not to `shared`, `api`, or `web`.

### Env / docs

- **REQ-011** `.env.example` shall declare `DEEPSEEK_API_KEY=` and shall NOT declare `GEMINI_API_KEY=`.
- **REQ-012** The root `CLAUDE.md` "Required env vars" line shall list `DEEPSEEK_API_KEY` (with the web-collector description) and shall not list `GEMINI_API_KEY`.
- **REQ-013** `packages/pipeline/CLAUDE.md` and `packages/shared/CLAUDE.md` shall reference `deepseek-chat` / `@ai-sdk/deepseek` / `DEEPSEEK_API_KEY` in every web-collector context where they previously referenced Gemini.
- **REQ-014** The `MODEL_PRICING` description in `packages/shared/CLAUDE.md` shall include the new `deepseek-chat` entry with its five rate fields.

### Tests

- **REQ-015** The existing `web.test.ts` block currently asserting the Gemini provider shall be updated to assert: `WEB_COLLECTOR_MODEL_ID === "deepseek-chat"`, the default-model factory imports `@ai-sdk/deepseek`, and the factory passes `process.env.DEEPSEEK_API_KEY` to `createDeepSeek`.
- **REQ-016** A new unit test in shared shall assert `MODEL_PRICING["deepseek-chat"]` exactly equals the five rates in REQ-004 (regression-guard against accidental rate changes).
- **REQ-017** A new unit test shall round-trip the captured probe sample (`{inputTokens: 351, outputTokens: 157, cachedInputTokens: 256}`) through `extractUsage("deepseek-chat", ...)` then `computeCallCost` and assert the resulting USD equals the hand-calculation: `(351-256)/1e6 * 0.14 + 256/1e6 * 0.0028 + 157/1e6 * 0.28 = 0.00005797680`. The extractor normalises `inputTokens` to the cache-miss portion (subtracts `cachedInputTokens`) before the formula bills it at `inputPerMTok` — the AI SDK reports `inputTokens` as total-including-cached for the DeepSeek and Gemini providers; without the subtraction the cached portion would be double-billed.

## 3. Constraints

- TypeScript strict — no `any`, no `as unknown as X` casts, explicit return types on exported functions.
- Module-cache pattern in `resolveDefaultModel` preserved (process-env credential, no admin-mutable freshness contract to break per `cache-vs-spec-promise-review.md`).
- Worktree-safe paths — all artifacts written under the worktree, never the main checkout (`harness-path-resolution-in-worktrees.md`).
- Provider-version pin per `ai-sdk-provider-version-must-match-ai-major.md`: use the `ai-v5` dist-tag literally, run `pnpm typecheck` immediately after install.

## 4. Out of scope

- Admin-configurable web-collector model (no `/admin/settings` integration).
- Migrating shortlist / rerank / recap / digest off Anthropic.
- Backfilling old `cost_breakdown` rows.
- Prompt tuning to maximise cache-hit rate.
- Building a fallback to Gemini 2.5 Flash-Lite at runtime — declared in the design's fallback chain only as a manual operator action if DeepSeek goes down for an extended period.

## 5. Verification Scenarios

Each scenario carries the unique id used by `functional-verify` to attribute proof in `proof-report.md`. VS-0 is a live re-run of the library probe; VS-1..VS-N are spec-derived behavioural checks.

### VS-0-deepseek-discovery (folded from `verification/verification-stubs.md`)

**Type:** api · **Run:** `node /media/aman/external/tmp/probe-deepseek-kRzinZ/probe-discovery.mjs` (also at `.harness/deepseek-v4-web-discovery/probes/deepseek/probe-discovery.mjs`)
**Pre-req:** `DEEPSEEK_API_KEY` from `.env.harness`.
**Expected:**
- Exit 0; both calls return 3 posts matching the discovery schema.
- Call 1: `usage.cachedInputTokens === 0`.
- Call 2 (same prompt within seconds): `usage.cachedInputTokens > 0`.
- `providerMetadata.deepseek.promptCacheHitTokens + promptCacheMissTokens === usage.inputTokens` on both calls.

### VS-1: Default-model factory uses DeepSeek

**Type:** unit · **Run:** `pnpm --filter @newsletter/pipeline test:unit web.test.ts`
**Expected:** The "default provider built from @ai-sdk/deepseek keyed by DEEPSEEK_API_KEY" test passes; the factory imports `@ai-sdk/deepseek`, calls `createDeepSeek({ apiKey: "test-deepseek-key-123" })`, and resolves the model id `"deepseek-chat"`.

### VS-2: Pricing-table entry is exact

**Type:** unit · **Run:** `pnpm --filter @newsletter/shared test:unit pricing` (or wherever the pricing test lives — add new test if absent)
**Expected:** `MODEL_PRICING["deepseek-chat"]` deep-equals `{ inputPerMTok: 0.14, outputPerMTok: 0.28, cacheReadPerMTok: 0.0028, cacheWrite5mPerMTok: 0, cacheWrite1hPerMTok: 0 }`. The Gemini entry is unchanged.

### VS-3: Cost math round-trip from probe sample

**Type:** unit · **Run:** `pnpm --filter @newsletter/shared test:unit cost`
**Expected:** `extractUsage("deepseek-chat", {inputTokens: 351, outputTokens: 157, cachedInputTokens: 256})` returns `{inputTokens:95, outputTokens:157, cachedInputTokens:256, cacheCreation5mTokens:0, cacheCreation1hTokens:0, reasoningTokens:0}` — the extractor subtracts `cachedInputTokens` from `inputTokens` so the cache-miss portion is what gets billed at `inputPerMTok`. `computeCallCost` of that shape against `"deepseek-chat"` returns `costUsd ≈ 0.00005797680` (within 1e-9 tolerance for FP rounding).

### VS-4: End-to-end cost-breakdown attribution

**Type:** e2e · **Run:** existing pipeline e2e suite covering `run-process` with the web collector
**Expected:** After a run with at least one blog source, `run_archives.cost_breakdown.stages["web-discovery"]` and `["web-extraction"]` each contain a `byModel` row with `modelId: "deepseek-chat"`, `costStatus: "ok"`, and `costUsd > 0`. No `"gemini-3.1-flash-lite"` rows are produced by the new code path. No `unknownModels` entry for `"deepseek-chat"`.

### VS-5: Build + typecheck + lint clean across monorepo

**Type:** ci · **Run:** `pnpm typecheck && pnpm lint && pnpm --filter @newsletter/pipeline test:unit && pnpm --filter @newsletter/shared test:unit`
**Expected:** All four exit 0. No new lint warnings beyond the 17-warning baseline. Pipeline unit count ≥ 1040 (baseline) — new tests add at least 3, total ≥ 1043.

### VS-6: Env / docs alignment

**Type:** docs · **Run:** manual grep
**Expected:**
- `.env.example` contains `DEEPSEEK_API_KEY=` line, no `GEMINI_API_KEY=` line.
- `grep -rn "gemini-3.1-flash-lite\|GEMINI_API_KEY\|@ai-sdk/google" packages/pipeline/src packages/shared/src` returns either zero matches or only matches inside the preserved legacy `MODEL_PRICING["gemini-3.1-flash-lite"]` entry. (The Gemini pricing entry is preserved by REQ-008 — that one match is expected.)
- Root + pipeline + shared `CLAUDE.md` files reference `deepseek-chat` / `DEEPSEEK_API_KEY` / `@ai-sdk/deepseek` in web-collector contexts.

## 6. Risks & mitigations

Mirrored from design.md § Risks. Two are now de-risked by the probe:

- **Field-name skew** — RESOLVED by probe. AI SDK normalises to `cachedInputTokens`; no provider-metadata parsing needed.
- **Structured-output reliability** — RESOLVED by probe. `generateObject` returned schema-clean JSON on both calls.

Remaining open risks (carried into ongoing operation, not blockers for ship):

- **Rolling-alias surprise** — `deepseek-chat` may shift to V5 in future. Mitigated by `costStatus` surfacing — we'd see `partial-unknown-model` and update the pricing table before silently mispricing.
- **Cache-hit assumption** — depends on prompt-prefix stability across calls. Current discovery prompt is stable (only `Today is YYYY-MM-DD` varies daily). Acceptable.
