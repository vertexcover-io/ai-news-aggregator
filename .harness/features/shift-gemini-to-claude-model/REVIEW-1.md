# Code Review #1 — Shift Ranking + Web Extraction LLM from Gemini to Claude

**Branch:** feat/claude-model-switch
**Commit under review:** c04133c
**Scope:** git diff main..HEAD
**Reviewer:** Senior Code Reviewer (automated)

## Verdict: APPROVE

## Summary

Mechanical provider swap from `@ai-sdk/google` (Gemini 2.5 Flash) to `@ai-sdk/anthropic@2.0.74` (Claude Haiku 4.5) executed cleanly. All 17 SPEC requirements map to real, precise changes in the diff. Version pinning, error-string exactness, exact-string test assertions, scope discipline, env var consistency, and the commit message template are all honored. One minor process observation noted but no defects requiring change.

## Defects Found

- Critical: 0
- Important: 0
- Minor: 1 (process observation, not an implementation defect)

## Details

### Correctness — all REQs satisfied

- **REQ-001 / package.json** (`packages/pipeline/package.json:18`): `"@ai-sdk/anthropic": "2.0.74"` — exact pin, no `^`/`~`. `@ai-sdk/google` removed. `pnpm-lock.yaml` resolves `2.0.74(zod@4.3.6)`.
- **REQ-002 / REQ-003 / ranking processor** (`packages/pipeline/src/processors/rank.ts:2,20,90`): imports `anthropic` from `@ai-sdk/anthropic`; `DEFAULT_MODEL = "claude-haiku-4-5-20251001"`; `generateObject` invoked with `anthropic(modelId)`.
- **REQ-005 / web collector** (`packages/pipeline/src/collectors/web.ts:336-337`): `resolveDefaultModel` uses `await import("@ai-sdk/anthropic")` and caches `anthropic("claude-haiku-4-5-20251001")`. Lazy dynamic import preserved.
- **REQ-006 / demo script** (`packages/pipeline/src/scripts/demo-web-collector.ts:16,21,102,108,112`): imports from `@ai-sdk/anthropic`, uses `anthropic("claude-haiku-4-5-20251001")`, prints new model id, header comment lists `ANTHROPIC_API_KEY`.
- **REQ-007 / boot validation** (`packages/pipeline/src/index.ts:23-25`): throws the EXACT mandated string `"ANTHROPIC_API_KEY is required for ranking"`. The prior `GOOGLE_GENERATIVE_AI_API_KEY ??= GEMINI_API_KEY` remap line is removed (REQ-008).
- **REQ-011 / `.env.example`** (`.env.example:10-12`): contains `ANTHROPIC_API_KEY=` and `RANKING_MODEL=claude-haiku-4-5-20251001`. `GEMINI_API_KEY` absent.
- **REQ-012 / smoke script** (`scripts/smoke-run.sh:11,14,18`): uses `: "${ANTHROPIC_API_KEY:?...}"` guard.
- **REQ-013 / root CLAUDE.md** (`CLAUDE.md:29,46`): data flow reads "Vercel AI SDK + Claude"; tech-stack row names `@ai-sdk/anthropic` + `claude-haiku-4-5-20251001`.
- **REQ-014 / pipeline CLAUDE.md** (`packages/pipeline/CLAUDE.md:14,26`): Claude-facing phrases present; no `GEMINI_API_KEY`, `Gemini`, or `gemini-2.5-flash`.
- **REQ-015 / run-ui SPEC** (`docs/plans/run-ui/SPEC.md:20`): REQ-003 row uses `ANTHROPIC_API_KEY` in both requirement and acceptance criterion text.
- **REQ-017 / web e2e** (`packages/pipeline/tests/e2e/collectors/web.e2e.test.ts:4,37,88`): imports `anthropic`, `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`, uses `anthropic("claude-haiku-4-5-20251001")`.

### REQ-065 test — exact-string assertions verified

`packages/pipeline/tests/unit/processors/rank.test.ts:210,216`:

```ts
expect(modelA.modelId).toBe("claude-sonnet-4-5");
// ...
expect(modelB.modelId).toBe("claude-haiku-4-5-20251001");
```

Both use `toBe` (exact) rather than `toContain` (substring), satisfying the `test-exact-spec-mandated-strings` learning and EDGE-006.

### Scope discipline — clean

- No modifications to historical docs `docs/plans/run-ui/phase-*.md`, `docs/plans/web-blog-collector/**`, or any `docs/plans/*-design.md` file other than the new `2026-04-08-gemini-to-claude-switch-design.md` (which is the design doc for THIS change being committed per project policy — correct scope).
- No refactors, prompt tweaks, schema edits, or unrelated "improvements."
- `packages/pipeline/src/collectors/hn.ts:11` still contains the keyword "Gemini" in an HN-filter keyword list — this is correct: it's the product/model-name keyword for topic filtering, not a code dependency reference. Leaving it alone is the right call.

### Version pinning — compliant

- `@ai-sdk/anthropic@2.0.74` exact (no `^`/`~`).
- `ai` stays at `5.0.169`; `zod@4.3.6` unchanged in the lockfile.
- Per `lock-ai-sdk-versions-explicitly`: provider + core stay within the same major (v5 exposes `generateObject`). Pass.

### TypeScript strictness — clean

Grep of diffed `.ts` files for `any`, `@ts-ignore`, `as unknown as`: zero new occurrences. No defensive handlers added on internal paths.

### Grep residues — clean (inside scope)

- `packages/pipeline/src/`, `scripts/`, `.env.example`, root `CLAUDE.md`, `packages/pipeline/CLAUDE.md`, `docs/plans/run-ui/SPEC.md`: zero matches for `@ai-sdk/google`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `gemini-2.5`.
- Historical docs under `docs/plans/**/phase-*.md`, `docs/plans/web-blog-collector/**`, and the older design docs retain Gemini references as expected per EDGE-008.

### Env var consistency — unified on `ANTHROPIC_API_KEY` + `claude-haiku-4-5-20251001`

Confirmed across: `.env.example`, `scripts/smoke-run.sh`, `CLAUDE.md`, `packages/pipeline/CLAUDE.md`, `docs/plans/run-ui/SPEC.md`, `packages/pipeline/src/index.ts`, `packages/pipeline/src/processors/rank.ts`, `packages/pipeline/src/collectors/web.ts`, `packages/pipeline/src/scripts/demo-web-collector.ts`, `packages/pipeline/tests/unit/processors/rank.test.ts`, `packages/pipeline/tests/e2e/collectors/web.e2e.test.ts`.

### Commit message — matches template

`git log` of c04133c shows the phase-1.md template reproduced verbatim, including bullet list and the `BREAKING CHANGE:` footer with both before/after env var lines. VER scope present (`feat(VER): ...`). Pass.

## Minor Finding (process, not code)

**F1 — phase-1.md contained contradictory Done criteria for `docs/plans/run-ui/SPEC.md`.**

Step 5c explicitly says "REQ-003 row only... Do not edit any other row," but Step 6's grep #5 (`"gemini-2\.5"` over `docs/plans/run-ui/SPEC.md`) would have failed because REQ-065's example token was `"google/gemini-2.5-flash"`. The coder pragmatically edited REQ-065's example from `"google/gemini-2.5-flash"` to `"claude-sonnet-4-5"` to satisfy Step 6, which also keeps the updated `rank.test.ts` assertion aligned with the SPEC example.

This is a **reasonable pragmatic decision** and the resulting edit is **correct** (the new example value also matches the `toBe("claude-sonnet-4-5")` test assertion). The defect is in the phase file's scoping (Step 5c should have listed the REQ-065 token as an allowed edit), not in the implementation.

**Recommendation:** No code change required. Flag for the planner agent so future phase files that include grep-based Done criteria explicitly enumerate every token expected to disappear from each allow-listed file.

## What Was Done Well

- Single clean commit, exact template adherence including BREAKING CHANGE footer.
- Exact version pin on provider package, consistent with the `lock-ai-sdk-versions-explicitly` rule.
- Exact-string test assertions (`toBe`) for REQ-065, satisfying the `test-exact-spec-mandated-strings` learning without having to be told twice.
- Lazy dynamic import in `web.ts` preserved (no shape regression).
- Kept `hn.ts` keyword list untouched — correctly distinguished "Gemini the product keyword" from "Gemini the dependency."
- Removed the legacy `GOOGLE_GENERATIVE_AI_API_KEY` remap rather than leaving a dead compatibility shim.
- No scope creep: no drive-by prompt edits, schema changes, or adjacent "improvements."

## Recommendation

**APPROVE** as-is. The single minor finding is a process observation about the phase file, not a defect in the delivered code. Proceed to quality gate and PR.
