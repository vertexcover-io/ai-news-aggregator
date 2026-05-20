# Plan — Improve Summary Generation: Our Opinion

**Spec:** `docs/spec/improve-summary-our-opinion/spec.md`
**Design:** `docs/spec/improve-summary-our-opinion/design.md`
**Branch:** feat/improve-summary-our-opinion

## Phase graph

```dot
digraph phases {
  rankdir=LR
  node [shape=box]
  phase_1 [label="Phase 1: Rewrite recap prompts + tests"]
}
```

Single phase — the change is small, tightly scoped, and the two prompt edits + their tests must land together (the unit tests reference both prompts).

## Phase 1 — Rewrite recap prompts + tests

### Files touched

| File | Change |
|---|---|
| `packages/pipeline/src/processors/rank-prompts.ts` | Rewrite the "recap content" block of `RANK_SYSTEM_PROMPT_NO_PROFILE` (currently lines ~40–72). Prepend an editorial-stance directive scoped to `bullets`+`bottomLine`. Keep the `summary` role description factual (ORIENT, ≤25 words, no analysis). Rewrite `bullets` and `bottomLine` role descriptions in voice-aware form. Add `DO NOT` block (scoped to bullets+bottomLine) and 2 bad/good example pairs (one for bullets, one for bottomLine). Leave the 5-axis block, the digest block, and the source-neutrality rule **byte-identical**. |
| `packages/pipeline/src/processors/recap.ts` | Same voice-aware rewrite applied to `RECAP_SYSTEM_PROMPT` — single-item version (no axes, no digest). `summary` stays factual. Schema (`recapContentSchema`) and `generateRecap()` body unchanged. |
| `packages/pipeline/tests/unit/processors/rank-prompts.test.ts` | Add a new `describe` block "editorial-stance recap content (REQ-001..REQ-006, REQ-010)" with tests for VS-1 and VS-2 from the spec. Keep all existing tests intact. |
| `packages/pipeline/tests/unit/processors/recap.test.ts` | Add a new `describe` block "editorial-stance prompt (REQ-007)" with tests for VS-3 and VS-4 from the spec. Keep existing tests intact. |

### Steps (sequential)

1. **Author shared prompt constants** in `rank-prompts.ts` — extract the voice-aware fragment into a single exported constant `RECAP_VOICE_BLOCK` so both files can `includes(RECAP_VOICE_BLOCK)` from the same source of truth. This keeps the two prompts uniform (REQ-007 demands identical voice rules). The constant must include: editorial-stance directive, voice-aware field descriptions for summary/bullets/bottomLine, DO NOT block, and bad/good examples.
2. **Wire `RECAP_VOICE_BLOCK` into `RANK_SYSTEM_PROMPT_NO_PROFILE`** — replace the current recap-content section (the lines that begin "For each ranked item, also produce structured story content..." through the last bottomLine example, before the digest section starts). Keep the digest section, the 5-axis section, and everything else byte-identical.
3. **Wire `RECAP_VOICE_BLOCK` into `RECAP_SYSTEM_PROMPT`** in `recap.ts` — `RECAP_SYSTEM_PROMPT` becomes a short single-item framing prefix + `RECAP_VOICE_BLOCK`. (Strip references to axes/digest since recap.ts is single-item.)
4. **Add unit tests** in `rank-prompts.test.ts` covering VS-1, VS-2 from spec.
5. **Add unit tests** in `recap.test.ts` covering VS-3, VS-4 from spec.
6. **Run `pnpm --filter @newsletter/pipeline test:unit`** — confirm new tests pass and no existing tests regress.
7. **Run `pnpm typecheck && pnpm lint`** — confirm no errors.
8. **Write `.harness/improve-summary-our-opinion/phase-1-claims.json`** following `skills/tdd/references/phase-claims-format.md`. Claims: rank-prompt voice block present, recap-prompt voice block present, schema unchanged, existing tests still green.
9. **Adversarial sample for VS-5/VS-6** — capture `verification/adversarial-findings.md` with a real before/after pair. This step is deferred to the Verify & Finalize stage but referenced here so the coder knows the adversarial artefact is required downstream.

### Acceptance for Phase 1

- All 4 new test cases pass (VS-1, VS-2, VS-3, VS-4).
- Existing tests in `rank-prompts.test.ts`, `recap.test.ts`, and downstream processor tests are still green.
- `pnpm typecheck` and `pnpm lint` clean.
- `phase-1-claims.json` written with `executed > 0`, `failed = 0`. No `type: "ui"` claims required — this phase has no UI surface (recap content is consumed downstream but the rendering paths are unchanged).
- `RECAP_VOICE_BLOCK` is the single source of voice rules; both prompts include it verbatim.

### Risks / careful-handling notes

- **Watch the prompt's 5-axis block and digest block in `rank-prompts.ts`** — these must stay byte-identical. If they drift, the ranking behaviour changes, which is out of scope.
- **`RANK_SYSTEM_PROMPT_NO_PROFILE` is referenced verbatim by `source-neutrality.test.ts`** — confirm none of those assertions break. They assert on the source-neutrality rule and the axes, both of which stay untouched.
- **Word budgets**: the 100-word combined budget per story stays in the prompt. The new voice block must not contradict or remove that ceiling.
- **No `as` casts, no `any` in new code** (per code-quality.md). Constants are plain `string` typed.
