# Gemini → Claude Provider Switch — Design Doc

**Date:** 2026-04-08
**Status:** Approved — proceed to spec + plan
**Scope:** Replace Google Gemini with Anthropic Claude as the sole LLM provider in the pipeline package.

---

## 1. Problem Statement

The pipeline currently uses `@ai-sdk/google` (Gemini 2.5 Flash) for two LLM tasks:
1. **Ranking** (`packages/pipeline/src/processors/rank.ts`) — scores ~100 candidate items per run and returns a structured ranked array with rationales.
2. **Web collector metadata extraction** (`packages/pipeline/src/collectors/web.ts` + `src/scripts/demo-web-collector.ts`) — extracts `title`, `author`, `publishedAt` from Jina-rendered listing pages.

We want to switch both call sites to Anthropic Claude via the Vercel AI SDK's unified provider API. Because both call sites already use `generateObject`, the swap is mostly a provider-module change plus env-var rename — no behavioral redesign.

## 2. Context

- Project is a TypeScript monorepo. The pipeline package is the only runtime consumer of the AI SDK. API and web packages do not call LLMs.
- `ai@5.0.169` (core) + `@ai-sdk/google@2.0.67` are currently installed with exact versions (per the project's `lock-ai-sdk-versions-explicitly` learning rule).
- Anthropic provider compatible with `ai@5.x` is `@ai-sdk/anthropic@2.x`. Latest 2.x line is `2.0.74`. We will pin this exact version and remove `@ai-sdk/google` entirely.
- The project CLAUDE.md already documents Gemini as the ranking LLM; this doc will be updated.

## 3. Current Gemini Touchpoints

Enumerated via grep; this is the complete surface area.

### Runtime code (pipeline)
| File | Current behavior |
|---|---|
| `packages/pipeline/package.json` | `"@ai-sdk/google": "2.0.67"` |
| `packages/pipeline/src/processors/rank.ts` | `import { google } from "@ai-sdk/google"` → `google(modelId)`; default `"gemini-2.5-flash"` |
| `packages/pipeline/src/collectors/web.ts` | Lazy `await import("@ai-sdk/google")` → `google("gemini-2.5-flash")` cached as `cachedDefaultModel` |
| `packages/pipeline/src/scripts/demo-web-collector.ts` | `google("gemini-2.5-flash")` + comment mentioning `GOOGLE_GENERATIVE_AI_API_KEY` |
| `packages/pipeline/src/index.ts` | Boot validates `GEMINI_API_KEY`, maps it onto `GOOGLE_GENERATIVE_AI_API_KEY` |

### Tests
| File | Current behavior |
|---|---|
| `packages/pipeline/tests/unit/processors/rank.test.ts` | Sets/reads `RANKING_MODEL`; asserts `modelA.modelId` contains `"gemini-2.5-pro"`/`"gemini-2.5-flash"` |
| `packages/pipeline/tests/e2e/collectors/web.e2e.test.ts` | `import { google } from "@ai-sdk/google"`; `google("gemini-2.5-flash")`; skip-if on `GEMINI_API_KEY` |

### Config / scripts / docs
| File | Current behavior |
|---|---|
| `.env.example` | `GEMINI_API_KEY=`, `RANKING_MODEL=gemini-2.5-flash` |
| `scripts/smoke-run.sh` | `: "${GEMINI_API_KEY:?...}"` hard check, mentions key in usage comment |
| `CLAUDE.md` (root) | "Ranking LLM: Vercel AI SDK + @ai-sdk/google (default gemini-2.5-flash)"; data-flow mentions Gemini |
| `packages/pipeline/CLAUDE.md` | "GEMINI_API_KEY validated at worker startup"; "RANKING_MODEL defaults to gemini-2.5-flash"; ranking uses "a Gemini model" |

### API boundary (not in pipeline)
`packages/api/src/routes/runs.ts` is expected to implement REQ-003 from `docs/plans/run-ui/SPEC.md`: when a run payload includes `web` config but `GEMINI_API_KEY` is not set, return HTTP 400 with a message mentioning `"GEMINI_API_KEY"`. Both the code and the historical SPEC need updating so the new assertion is `ANTHROPIC_API_KEY`. **Planning stage will verify this file exists and find the exact call site.**

## 4. Requirements

### Functional
- **F1.** Ranking continues to produce a `RankedItemRef[]` matching the existing zod schema; no contract change.
- **F2.** Web collector continues to extract `title`, `author`, `publishedAt` via `generateObject` with the existing schemas; no contract change.
- **F3.** Default model for both call sites is `claude-haiku-4-5-20251001` (Claude Haiku 4.5 — fastest + cheapest 4.x model, good fit for structured ranking over ~100 candidates and for 3-field metadata extraction).
- **F4.** `RANKING_MODEL` env var continues to override the ranking default (no behavior change other than the accepted values).
- **F5.** Boot validation in `packages/pipeline/src/index.ts` requires `ANTHROPIC_API_KEY` (not `GEMINI_API_KEY`) and throws at startup if missing.
- **F6.** API REQ-003 validation (`POST /api/runs` with `web` config) checks `ANTHROPIC_API_KEY` instead of `GEMINI_API_KEY`, and the 400 error body mentions `"ANTHROPIC_API_KEY"`.

### Non-functional
- **N1.** Strict TypeScript — no `any`, no `as unknown as X` casts.
- **N2.** Exact version pinning: `@ai-sdk/anthropic@2.0.74`. No `^`/`~`. `@ai-sdk/google` is removed from `packages/pipeline/package.json`.
- **N3.** All existing unit tests continue to pass (178 currently). New/updated assertions must use exact strings per the `test-exact-spec-mandated-strings` learning.
- **N4.** Lint + typecheck must stay clean at every logical step (per `run-lint-during-coding-not-just-review`).
- **N5.** No scope creep: do not refactor rank/web logic, prompts, or schemas beyond what the provider change requires.

### Edge cases
- **E1.** **Removed provider import paths.** Any dangling `@ai-sdk/google` reference after the swap breaks the typecheck — grep after the change to confirm zero matches.
- **E2.** **Test `modelId` string assertions.** `rank.test.ts` asserts `modelId` contains `"gemini-2.5-pro"`/`"gemini-2.5-flash"` at lines 206, 210, 216. These must switch to exact Claude model IDs (e.g. `"claude-sonnet-4-5"` override + `"claude-haiku-4-5-20251001"` default), or equivalent.
- **E3.** **Lazy-imported provider in web.ts.** The provider is loaded via `await import("@ai-sdk/google")` at line 336 inside `getDefaultModel()`. This must become `await import("@ai-sdk/anthropic")` and the cached model must be `anthropic("claude-haiku-4-5-20251001")`. Keep the lazy import — it's used so the collector module loads without a provider at import time.
- **E4.** **Historical SPEC reference.** `docs/plans/run-ui/SPEC.md` REQ-003 quotes `GEMINI_API_KEY`. Update the SPEC in-place to `ANTHROPIC_API_KEY` so it matches the new behavior (the SPEC is a living doc, not an immutable audit log).
- **E5.** **Env var map in `pipeline/src/index.ts`.** The existing code does `process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= process.env.GEMINI_API_KEY`. Anthropic provider reads `ANTHROPIC_API_KEY` directly, so the remap line is deleted outright, not replaced.
- **E6.** **E2E test env guard.** `web.e2e.test.ts` uses `describe.skipIf(!process.env.GEMINI_API_KEY)` (via the plan doc pattern). Update to `ANTHROPIC_API_KEY` — otherwise the test silently skips even when the key is present under the new name.
- **E7.** **CLAUDE.md drift.** Root CLAUDE.md and pipeline CLAUDE.md both describe the LLM provider. The sync-docs stage catches this later, but the coder stage should update them in the same commit that changes the code, so docs don't drift at any intermediate commit.
- **E8.** **Developer `.env` break.** Renaming `GEMINI_API_KEY` → `ANTHROPIC_API_KEY` is a hard break for anyone with an existing `.env`. Mitigation: update `.env.example` in the same commit and call it out in the PR body + commit message. No code-level shim.

## 5. Key Insights

1. **This is almost entirely a mechanical rename.** The AI SDK's unified provider API means `google(modelId)` → `anthropic(modelId)` is the only semantic change at call sites. `generateObject` signature and zod schema handling are identical.
2. **Schema constraints are relaxed by the switch, but we won't exploit it.** The web collector schemas were "designed to avoid unions and z.record to pass Gemini's structured output" (per `docs/plans/2026-04-07-web-blog-collector-design.md`). Claude does not have those constraints, but we keep the schemas unchanged to avoid scope creep — a separate task can simplify them later if wanted.
3. **Env var semantics move from mapped to direct.** Gemini's provider reads `GOOGLE_GENERATIVE_AI_API_KEY` and we had a `??=` map from `GEMINI_API_KEY`. Anthropic's provider reads `ANTHROPIC_API_KEY` directly, so the mapping line simply disappears — fewer moving parts.
4. **No dual-provider transition period.** The user chose "Replace", not "alias" or "keep both". This keeps the diff small and the env surface minimal, at the cost of requiring everyone to update their `.env` once.

## 6. Architectural Challenges

- **Boundaries:** All LLM-calling code lives in `@newsletter/pipeline`. The API package only reads `process.env.GEMINI_API_KEY` for REQ-003 validation, not the SDK itself. After this change, the API package imports nothing new.
- **Data flow:** Unchanged. Candidates → ranker → `RankedItemRef[]` → Redis run-state. Jina markdown → extractor → `RawItemInsert[]` → repo upsert.
- **Contracts:** All zod schemas (`rankedResponseSchema`, web-collector schemas) remain identical. Output shape is provider-independent.
- **Evolution:** Single-provider posture is simpler but locks us to one vendor. If a future task wants multi-provider (e.g. Claude for ranking, a cheap model for extraction), the ranker can accept `modelId` already via `RankOptions.modelId` + `RANKING_MODEL` env — the mechanism survives. Only `getDefaultModel()` in `web.ts` is hardcoded and would need similar extraction if multi-provider becomes a requirement. Out of scope for this task.

## 7. Approaches Considered

Only one approach under the chosen scope — mechanical provider swap. Approach variants that were rejected upstream (during the Q&A):

- **Alias-shim approach** (keep `GEMINI_API_KEY` name as a remap to `ANTHROPIC_API_KEY`) — rejected. Leaves a confusing indirection in code and long-term debt for zero real benefit.
- **Rank-only or web-only partial swap** — rejected. Keeps two provider dependencies and two env vars for no benefit; the user wants one provider.

## 8. Chosen Approach — High-Level Plan

Two independent code changes (can both land in a single commit; no inter-file dependency issues):

### 8.1 Dependency swap
- Remove `@ai-sdk/google@2.0.67` from `packages/pipeline/package.json`.
- Add `@ai-sdk/anthropic@2.0.74` to `packages/pipeline/package.json` dependencies (exact version).
- `pnpm install` to update the lockfile.

### 8.2 Runtime code swap
- `packages/pipeline/src/processors/rank.ts`: change import to `anthropic`, change default model to `claude-haiku-4-5-20251001`, call `anthropic(modelId)` in the `generateObject({ model: ... })` line.
- `packages/pipeline/src/collectors/web.ts`: change the lazy import inside `getDefaultModel()` to `@ai-sdk/anthropic` and cache `anthropic("claude-haiku-4-5-20251001")`.
- `packages/pipeline/src/scripts/demo-web-collector.ts`: same as web.ts plus update the printed "model: …" line and the top-of-file env comment.
- `packages/pipeline/src/index.ts`: validate `ANTHROPIC_API_KEY` at boot; delete the `GOOGLE_GENERATIVE_AI_API_KEY ??= GEMINI_API_KEY` line.

### 8.3 API validation update
- Find the REQ-003 validation in `packages/api/src/routes/runs.ts` (planning stage will locate the exact file/line).
- Replace `GEMINI_API_KEY` check + error message with `ANTHROPIC_API_KEY`.
- Update any corresponding API integration test to assert the new exact string.

### 8.4 Tests update
- `packages/pipeline/tests/unit/processors/rank.test.ts`:
  - Replace `process.env.RANKING_MODEL = "gemini-2.5-pro"` with a Claude override (e.g. `"claude-sonnet-4-5"`).
  - Update both `expect(modelA.modelId).toContain(...)` and `expect(modelB.modelId).toContain(...)` assertions to the new IDs (exact strings per the test-exact-spec-mandated-strings rule).
- `packages/pipeline/tests/e2e/collectors/web.e2e.test.ts`:
  - Swap `google` import to `anthropic`.
  - Change model to `anthropic("claude-haiku-4-5-20251001")`.
  - Update the `describe.skipIf(...)` guard to check `ANTHROPIC_API_KEY`.
- Add **no new tests**. The existing tests fully cover the provider injection point (the ranker takes `generate` as a DI arg in unit tests, so provider behavior isn't exercised in unit tests — only the `model.modelId` string surface is). The e2e test is the only real provider-hitting test and is env-gated.

### 8.5 Config + scripts
- `.env.example`: rename `GEMINI_API_KEY` → `ANTHROPIC_API_KEY`; change `RANKING_MODEL=gemini-2.5-flash` → `RANKING_MODEL=claude-haiku-4-5-20251001`; update the comment header.
- `scripts/smoke-run.sh`: change the hard check to `ANTHROPIC_API_KEY`; update the usage comment at the top.
- Note: there is no live `.env` rename happening in this worktree — the developer must update their own `.env` after pulling. Call this out in the PR body.

### 8.6 Docs
- `CLAUDE.md` (root): change "Ranking LLM" row and data-flow sentence. Only these two touches — no restructuring.
- `packages/pipeline/CLAUDE.md`: change the `GEMINI_API_KEY` line, the `RANKING_MODEL` default, and the "uses a Gemini model" phrase.
- `docs/plans/run-ui/SPEC.md` REQ-003: rename the env var and the exact-string assertion.
- sync-docs stage will double-check all docs after the coder phase.

### 8.7 Verification
- `pnpm typecheck` clean.
- `pnpm lint` clean.
- `pnpm test:unit` all 178 tests still green (assertions updated for new model IDs but count unchanged).
- `grep -r "gemini\|@ai-sdk/google\|GEMINI_API_KEY\|GOOGLE_GENERATIVE_AI_API_KEY" packages/ scripts/ .env.example CLAUDE.md` returns zero matches (except possibly historical docs under `docs/plans/*-design.md` which are immutable archives — to be explicitly allowed).

## 9. Open Questions

None at design time. One deferred detail for planning:

- **Exact API file for REQ-003.** The planner should locate the `GEMINI_API_KEY` check in `packages/api/src/routes/runs.ts` (or wherever run creation lives) and the matching integration test, and include them in the phase files. Grepping `GEMINI_API_KEY` inside `packages/api/` will find it in one step.

## 10. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude model ID `claude-haiku-4-5-20251001` not accepted by `@ai-sdk/anthropic@2.0.74` | Low | High (boot fails) | Verify in planning via a minimal `anthropic("claude-haiku-4-5-20251001")` smoke + reading provider docs/types. If rejected, fall back to `claude-haiku-4-5` or the latest dated haiku ID the provider version accepts. |
| `generateObject` with Claude behaves differently on tool-use-based structured output (e.g. retries, repair) | Low | Medium (ranking returns no valid items) | Existing error path `"ranking returned no valid items"` catches this. No change needed; e2e run will validate. |
| Removed env var breaks a team member's local `.env` | Certain | Low | PR body spells out the rename and the 1-line fix. No code shim. |
| Anthropic rate limits bite harder than Gemini on ranking 100 candidates | Low | Medium | Single `generateObject` call per run — well under any tier's per-minute limit. Not a real risk. |
| Hidden `GEMINI_API_KEY` reference in an untouched file | Low | Low (typecheck or grep catches it) | Final grep verification step in 8.7. |

## 11. Assumptions

1. The user has (or will provision) an `ANTHROPIC_API_KEY` before merging. The PR does not need to verify the key works in CI.
2. `@ai-sdk/anthropic@2.0.74` is wire-compatible with the currently pinned `ai@5.0.169`. Confirmed by the 2.x major line alignment with `@ai-sdk/google@2.x` already in use.
3. Schemas currently shaped "for Gemini compatibility" work at least as well on Claude (the restrictions were Gemini-specific; Claude is a superset). No schema changes required.
4. The `docs/plans/run-ui/SPEC.md` REQ-003 entry is a living spec, not an immutable audit artifact — it may be edited in place.
5. Deleted `@ai-sdk/google` has no other importers in the workspace. (Verified via grep: only pipeline package imports it.)
