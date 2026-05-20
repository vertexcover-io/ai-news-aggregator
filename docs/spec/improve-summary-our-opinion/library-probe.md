# Library Probe — improve-summary-our-opinion

<!-- LP:VERDICT:PASS -->

**Verdict:** NOT_APPLICABLE → PASS (no external dependencies introduced)

## Scope

The design (`docs/spec/improve-summary-our-opinion/design.md` §5) declares no new external libraries, no new APIs, no new model, no SDK version bumps. The change is a string replacement inside two existing prompt files:

- `packages/pipeline/src/processors/rank-prompts.ts`
- `packages/pipeline/src/processors/recap.ts`

Both files already use:

- `ai` (Vercel AI SDK) — `generateObject({ ... })` — exercised every live run.
- `@ai-sdk/anthropic` — `anthropic(modelId)` — exercised every live run.
- `@anthropic-ai/sdk` (transitively) with model `claude-haiku-4-5-20251001` — exercised every live run.

There is no external surface to verify that isn't already being verified by the existing production code path on every newsletter run.

## Existing-dep health

| Lib | Status | Evidence |
|---|---|---|
| `ai` (Vercel AI SDK) | VERIFIED (in use) | Used at 4 LLM call sites across the pipeline; last successful run is the most recent merged archive on `main`. |
| `@ai-sdk/anthropic` | VERIFIED (in use) | Same — already exercised by every successful `rank` + `recap` invocation. |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | VERIFIED (in use) | Default model; pinned in `processors/rank.ts` and `processors/recap.ts`. |

## Fallback chain

N/A — no library change to fall back from.

## Re-plan Required

No.
