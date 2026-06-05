# SPEC: Shift Ranking + Web Extraction LLM from Gemini to Claude

**Source:** docs/plans/2026-04-08-gemini-to-claude-switch-design.md
**Generated:** 2026-04-08

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The pipeline package shall depend on `@ai-sdk/anthropic` at exact version `2.0.74` and shall not depend on `@ai-sdk/google`. | `packages/pipeline/package.json` contains `"@ai-sdk/anthropic": "2.0.74"` (no `^`/`~`) and contains no `@ai-sdk/google` entry. `pnpm-lock.yaml` resolves `@ai-sdk/anthropic@2.0.74` and contains no `@ai-sdk/google` version matching the removed pin. | Must |
| REQ-002 | Ubiquitous | The ranking processor shall call `anthropic(modelId)` (not `google(modelId)`) as the model argument to `generateObject`. | `packages/pipeline/src/processors/rank.ts` imports only from `@ai-sdk/anthropic`; the `generateObject` call site passes `anthropic(modelId)`. Grep for `@ai-sdk/google` in `packages/pipeline/src/` returns zero matches. | Must |
| REQ-003 | Ubiquitous | The ranking processor default model shall be `claude-haiku-4-5-20251001`. | `rank.ts` defines `DEFAULT_MODEL = "claude-haiku-4-5-20251001"`. With `process.env.RANKING_MODEL` unset and no `options.modelId`, the model passed to `generateObject` has `modelId === "claude-haiku-4-5-20251001"`. | Must |
| REQ-004 | Event-driven | When `process.env.RANKING_MODEL` is set to a non-empty string and `options.modelId` is not provided, the ranking processor shall resolve the model id to `process.env.RANKING_MODEL`. | Unit test sets `process.env.RANKING_MODEL = "claude-sonnet-4-5"`, calls the ranker, and asserts the injected `generate` saw a model with `modelId === "claude-sonnet-4-5"`. | Must |
| REQ-005 | Ubiquitous | The web collector's default extraction model shall be `anthropic("claude-haiku-4-5-20251001")` loaded via a lazy dynamic import of `@ai-sdk/anthropic`. | `packages/pipeline/src/collectors/web.ts` `getDefaultModel()` uses `await import("@ai-sdk/anthropic")` and caches `anthropic("claude-haiku-4-5-20251001")`. Grep for `@ai-sdk/google` in `web.ts` returns zero matches. | Must |
| REQ-006 | Ubiquitous | The `demo-web-collector.ts` script shall use `anthropic("claude-haiku-4-5-20251001")` and shall document `ANTHROPIC_API_KEY` as the required env var. | `packages/pipeline/src/scripts/demo-web-collector.ts` imports from `@ai-sdk/anthropic`, assigns `anthropic("claude-haiku-4-5-20251001")`, prints `"model:     claude-haiku-4-5-20251001"`, and the header comment lists `ANTHROPIC_API_KEY` (not `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY`). | Must |
| REQ-007 | Event-driven | When the pipeline worker process starts and `process.env.ANTHROPIC_API_KEY` is unset or empty, the process shall throw an error whose message contains the exact string `"ANTHROPIC_API_KEY is required for ranking"`. | `packages/pipeline/src/index.ts` validates `ANTHROPIC_API_KEY` at boot and throws with that exact message. The prior `GOOGLE_GENERATIVE_AI_API_KEY ??= GEMINI_API_KEY` line is removed. | Must |
| REQ-008 | Ubiquitous | The pipeline boot code shall not reference `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or remap any legacy key to a new name. | Grep for `GEMINI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` in `packages/pipeline/src/` returns zero matches. | Must |
| REQ-009 | Ubiquitous | The API package shall not reference `GEMINI_API_KEY`. | Grep for `GEMINI_API_KEY` in `packages/api/` (src + tests) returns zero matches. Note: as of this change the API does **not** validate either key — no code path reads `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` in the API package. This is a verification requirement, not an implementation one. | Must |
| REQ-011 | Ubiquitous | `.env.example` shall declare `ANTHROPIC_API_KEY` (no value) and set `RANKING_MODEL=claude-haiku-4-5-20251001`, and shall not declare `GEMINI_API_KEY`. | `.env.example` contains a line starting with `ANTHROPIC_API_KEY=` and a line `RANKING_MODEL=claude-haiku-4-5-20251001`. Grep for `GEMINI_API_KEY` in `.env.example` returns zero matches. | Must |
| REQ-012 | Event-driven | When `scripts/smoke-run.sh` is executed with `ANTHROPIC_API_KEY` unset, it shall exit with a non-zero status and an error message referencing `ANTHROPIC_API_KEY`. | `scripts/smoke-run.sh` contains `: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required (must be set in pipeline env)}"` (or equivalent). Running the script with the var unset exits non-zero and stderr contains `ANTHROPIC_API_KEY`. Grep for `GEMINI_API_KEY` in `scripts/smoke-run.sh` returns zero matches. | Must |
| REQ-013 | Ubiquitous | Root `CLAUDE.md` shall describe the ranking LLM as Vercel AI SDK + `@ai-sdk/anthropic` with default `claude-haiku-4-5-20251001`, and shall not mention `@ai-sdk/google` or Gemini as the ranking provider. | The tech-stack row for "Ranking LLM" names `@ai-sdk/anthropic` and `claude-haiku-4-5-20251001`. The data-flow paragraph says "ranks via Vercel AI SDK + Claude" (or equivalent). Grep for `@ai-sdk/google` and `gemini` in root `CLAUDE.md` returns zero matches. | Must |
| REQ-014 | Ubiquitous | `packages/pipeline/CLAUDE.md` shall state that ranking uses a Claude model, that `ANTHROPIC_API_KEY` is validated at worker startup, and that `RANKING_MODEL` defaults to `claude-haiku-4-5-20251001`. | Grep for `GEMINI_API_KEY`, `Gemini`, and `gemini-2.5-flash` in `packages/pipeline/CLAUDE.md` returns zero matches. All three Claude-facing phrases are present. | Must |
| REQ-015 | Ubiquitous | `docs/plans/run-ui/SPEC.md` REQ-003 shall reference `ANTHROPIC_API_KEY` instead of `GEMINI_API_KEY`. | Reading `docs/plans/run-ui/SPEC.md` shows REQ-003 uses the literal `ANTHROPIC_API_KEY` in both the requirement text and the acceptance criterion. | Must |
| REQ-016 | Ubiquitous | All existing unit tests in `@newsletter/pipeline` shall continue to pass with the Claude-based defaults. | `pnpm test:unit` exits 0 with at least 178 tests passing (baseline count; count may stay the same since the switch rewrites assertions but adds no tests). | Must |
| REQ-017 | Ubiquitous | The e2e web collector test shall use `anthropic("claude-haiku-4-5-20251001")` and guard execution on `process.env.ANTHROPIC_API_KEY`. | `packages/pipeline/tests/e2e/collectors/web.e2e.test.ts` imports `anthropic` from `@ai-sdk/anthropic` and the `describe.skipIf(...)` guard checks `process.env.ANTHROPIC_API_KEY`. Grep for `@ai-sdk/google` and `GEMINI_API_KEY` in the e2e test returns zero matches. | Must |
| REQ-018 | Ubiquitous | `pnpm typecheck` and `pnpm lint` shall exit 0 across all packages after the switch. | Both commands exit 0 with zero errors and zero warnings (matches baseline). | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | A dangling `@ai-sdk/google` import is left behind in any `packages/pipeline/src/**/*.ts` file. | TypeScript compilation fails (package removed) and/or post-change grep flags the import. Must be fixed before completion. | REQ-001, REQ-002, REQ-005 |
| EDGE-002 | `RANKING_MODEL` is set to an old Gemini id (e.g. `"gemini-2.5-flash"`). | The ranker passes that string through to `anthropic(...)`; the provider rejects it at call time with its own error. No pre-validation is added — the user is expected to fix their env. This is documented behavior, not a bug. | REQ-004 |
| EDGE-003 | A developer still has `GEMINI_API_KEY` in their local `.env` and no `ANTHROPIC_API_KEY`. | Pipeline boot throws with the exact REQ-007 message. No silent fallback. | REQ-007, REQ-008 |
| EDGE-004 | `process.env.ANTHROPIC_API_KEY` is set to an empty string `""`. | Pipeline boot treats empty-string the same as unset and throws with the REQ-007 message. | REQ-007 |
| EDGE-005 | An `.env` left over from the previous Gemini world is loaded into the API package. | No runtime effect — the API package reads neither key today. Validation remains a pipeline-only concern. | REQ-009 |
| EDGE-006 | The `rank.test.ts` assertion that previously matched `"gemini-2.5-pro"` is updated to a new Claude id. | The test uses exact-string comparison for the expected `modelId` (per `test-exact-spec-mandated-strings` learning) and still passes. | REQ-004, REQ-016 |
| EDGE-007 | `cachedDefaultModel` in `web.ts` was populated by a prior Gemini import before the swap was applied to a running dev process. | Not a runtime concern — the dev server restarts on save. Documented to prevent confusion during manual testing. | REQ-005 |
| EDGE-008 | A historical design doc under `docs/plans/*-design.md` or `docs/plans/run-ui/phase-*.md` still mentions Gemini. | Left unchanged — historical design docs are audit artifacts, not living references. Only `docs/plans/run-ui/SPEC.md` REQ-003 is updated (REQ-015). | REQ-015 |
| EDGE-009 | `@ai-sdk/anthropic@2.0.74` rejects the model id `"claude-haiku-4-5-20251001"` at runtime. | Planner must verify the id is accepted by the installed provider version before the coder phase. If not, fall back to the nearest accepted id (`"claude-haiku-4-5"` or latest dated haiku 4.5) and update REQ-003/REQ-005/REQ-006/REQ-011 in the SPEC before coding. | REQ-003, REQ-005, REQ-011 |
| EDGE-010 | Ranker receives an empty candidate array. | Existing short-circuit returns `{ rankedItems: [], candidateCount: 0, rankedCount: 0 }` without calling the model. Unchanged by this switch. | REQ-002 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | Manual Test | Notes |
|--------|-----------|-----------------|-------------|-------|
| REQ-001 | No | No | Yes | Grep + file inspection during code review. |
| REQ-002 | Yes | No | Yes | Existing rank.test.ts verifies model injection; grep confirms no stray imports. |
| REQ-003 | Yes | No | No | rank.test.ts default-model assertion. |
| REQ-004 | Yes | No | No | rank.test.ts REQ-065-style override test (renamed/updated in this spec). |
| REQ-005 | No | No | Yes | Static inspection + grep; existing web unit tests already cover the path with DI. |
| REQ-006 | No | No | Yes | Script inspection during review. |
| REQ-007 | Yes | No | No | Pipeline boot test (or module-load test) that temporarily unsets the env var and asserts the exact error string. |
| REQ-008 | No | No | Yes | Grep step in quality gate. |
| REQ-009 | No | No | Yes | Grep verification only. API package has no LLM env validation today. |
| REQ-011 | No | No | Yes | File inspection + grep. |
| REQ-012 | No | No | Yes | Shell execution check during code review; grep step. |
| REQ-013 | No | No | Yes | File inspection + grep. |
| REQ-014 | No | No | Yes | File inspection + grep. |
| REQ-015 | No | No | Yes | File inspection. |
| REQ-016 | Yes | Yes | No | `pnpm test:unit` in quality gate. |
| REQ-017 | No | Yes | Yes | e2e test is env-gated; file inspection for the other parts. |
| REQ-018 | No | No | Yes | Quality gate runs both commands. |
| EDGE-001 | No | No | Yes | Grep in quality gate. |
| EDGE-002 | No | No | Yes | Documented behavior; no test. |
| EDGE-003 | Yes | No | No | Covered by REQ-007 boot test. |
| EDGE-004 | Yes | No | No | Boot test includes empty-string case. |
| EDGE-005 | No | No | Yes | Grep-only; no runtime path to test. |
| EDGE-006 | Yes | No | No | Assertion uses `toBe(exact)` not `toContain(substring)`. |
| EDGE-007 | No | No | No | Documentation only. |
| EDGE-008 | No | No | Yes | Reviewer confirms historical docs were not edited. |
| EDGE-009 | No | No | Yes | Planner verifies before coding; SPEC may be amended if the id is rejected. |
| EDGE-010 | Yes | No | No | Pre-existing test; unchanged. |

## Out of Scope

- **Simplifying web collector schemas** to use unions or `z.record` (previously avoided for Gemini compatibility). Left for a follow-up task.
- **Dual-provider support** (e.g. Claude for ranking + some other provider for extraction). This change consolidates on a single provider.
- **Env-var alias / backward-compat shim** mapping `GEMINI_API_KEY` → `ANTHROPIC_API_KEY`. Deliberately rejected during brainstorm.
- **Adding a new test that hits the real Anthropic API** beyond the existing env-gated e2e test.
- **Changing the ranking prompt, schema, or scoring rubric.**
- **Upgrading `ai` core or other `@ai-sdk/*` packages** beyond adding `@ai-sdk/anthropic@2.0.74` and removing `@ai-sdk/google@2.0.67`.
- **Editing historical design docs** under `docs/plans/*-design.md` or `docs/plans/run-ui/phase-*.md`. Only `docs/plans/run-ui/SPEC.md` REQ-003 is updated because it is the live SPEC for that feature.
- **Model-selection logic for web.ts** (making the web default configurable via env). Hardcoded default is fine for now.
- **Automated verification that `claude-haiku-4-5-20251001` is a currently-supported Anthropic model id.** Planner checks once; runtime will surface any error.
