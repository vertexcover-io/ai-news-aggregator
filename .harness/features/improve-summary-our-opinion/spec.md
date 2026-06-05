# Spec — Improve Summary Generation: Our Opinion

**Source design:** `docs/spec/improve-summary-our-opinion/design.md`
**Library-probe verdict:** NOT_APPLICABLE (prompt-only; no external dep change)
**Date:** 2026-05-20

## 1. Summary

Restructure the two recap-generation prompts so that the LLM forms our editorial stance from the source facts, then writes `bullets` and `bottomLine` through that stance. `summary` remains a neutral fact-first one-sentence orient (unchanged role). Hard prohibition on echoing the source author's framing or opinion in `bullets` and `bottomLine`. Output schema and DB columns unchanged.

## 2. Requirements (EARS format)

**REQ-001** — When the rank processor invokes `generateObject` to produce ranked items, the system prompt SHALL include an explicit editorial-stance instruction that directs the model to form our take on the story *before* writing `bullets` and `bottomLine`.

**REQ-002** — When the rank processor's prompt describes the `summary` field, it SHALL preserve the current factual ORIENT role ("state what happened, fact-first, ≤25 words, no analysis"). The summary field is explicitly outside the scope of the voice change.

**REQ-003** — When the rank processor's prompt describes the `bullets` field, it SHALL require bullets to be concrete facts *from the source* selected through our editorial stance, and SHALL forbid bullets that merely paraphrase the source author's argument or framing.

**REQ-004** — When the rank processor's prompt describes the `bottomLine` field, it SHALL require the bottomLine to be our strategic so-what in our voice, and SHALL forbid it from being a softer paraphrase of the source's own conclusion.

**REQ-005** — When the rank processor's prompt is rendered, it SHALL contain a `DO NOT` block enumerating these forbidden patterns:
- "The author argues…" / "They say…" / "According to <source>…" / "<source author> writes…"
- Lifting descriptive adjectives the source uses about itself (e.g. a vendor calling its own release "revolutionary")
- Paraphrasing the source's thesis when the source IS the protagonist of the story
- Inventing facts not present in the source

**REQ-006** — When the rank processor's prompt is rendered, it SHALL contain at least two `Bad → Good` example pairs demonstrating voice rewrites (one for `bullets`, one for `bottomLine`). No example pair is required for `summary` (it is unchanged).

**REQ-007** — When the recap processor (`processors/recap.ts`, used by the add-post flow) invokes `generateObject`, it SHALL use the SAME voice rules as the rank processor (REQ-001..REQ-006 applied to its `RECAP_SYSTEM_PROMPT`), so a story added manually receives identical editorial treatment to a story ranked in a normal run.

**REQ-008** — The Zod schema for recap content (`recapContentSchema` in `recap.ts` and the equivalent in `rank.ts`) SHALL remain unchanged. Output field names and types do not change.

**REQ-009** — When existing reviewed archives (created before this change) are rendered, the system SHALL continue to display their stored recap content unchanged. No backfill occurs.

**REQ-010** — When the rank processor's prompt is rendered, the 5-axis scoring system and the digest-level fields (`headline`, `summary`, `hook`, `twitterSummary`) SHALL remain unchanged. Only the per-item recap-content section is modified.

## 3. Verification Scenarios

### VS-1 — Rank prompt contains editorial-stance instruction scoped to bullets+bottomLine (REQ-001, REQ-002, REQ-003, REQ-004)

Unit test in the existing `packages/pipeline/tests/unit/processors/rank-prompts.test.ts` (extend, do not replace) that imports `RANK_SYSTEM_PROMPT_NO_PROFILE` and asserts:

- Contains the editorial-stance directive (regex matches `our (editorial )?(take|stance|voice)` near `before` / `first`).
- Voice-claim language (e.g. `in our voice`, `our editorial voice`) appears in the `bullets` and `bottomLine` field descriptions.
- The `summary` field description still asserts the factual ORIENT role: contains the phrase `state what happened` (case-insensitive) — this is a positive regression guard ensuring `summary` is NOT swept into the voice change.

### VS-2 — Rank prompt contains DO NOT block + examples (REQ-005, REQ-006)

Same test file:

- Contains a `DO NOT` block with at least 3 of the forbidden patterns enumerated verbatim.
- Contains at least 2 `Bad`/`Good` example pairs.

### VS-3 — Recap prompt mirrors voice rules (REQ-007)

Unit test in `packages/pipeline/tests/unit/processors/recap.test.ts` (extend existing test file if present, otherwise new) that imports `RECAP_SYSTEM_PROMPT` and asserts the same voice-aware language is present (editorial-stance directive, voice claim on `summary`, DO NOT block).

### VS-4 — Schema unchanged (REQ-008)

Unit test asserting `recapContentSchema.shape` has exactly the keys `{ title, summary, bullets, bottomLine }` (no new keys, no removed keys).

### VS-5 — Live behavioral check (REQ-001..REQ-007) — adversarial

Manual, captured in `verification/adversarial-findings.md`:

- Take 1 vendor-blog source body (where the author calls their own product "revolutionary" or similar).
- Run the recap helper against it (either via a small Vitest scratch test stubbed with the live SDK, or via the add-post flow on a running dev pipeline).
- Manually inspect the produced `bullets` and `bottomLine`. Record:
  - Before sample (from a similar source pre-change, found in DB).
  - After sample (from the live run).
  - Verdict — does the After bullets/bottomLine sound like our voice and not the source author's? `summary` is excluded from this check by design (it stays factual). (Subjective but binary.)

### VS-6 — Existing archives unaffected (REQ-009)

Visual sanity check (captured in adversarial-findings.md): open `/archive/<existing-run-id>` for an archive created before this change and confirm it still renders correctly (recap fields still present and readable). No code change is expected to affect this path; this scenario exists to prove the lack of regression.

## 4. Acceptance Criteria

All of the following must hold:

1. VS-1 through VS-4 pass as Vitest unit tests under `pnpm test:unit`.
2. VS-5 adversarial check produces a before/after pair where the "After" summary or bottomLine clearly does not echo the source author's voice (subjective binary judgment, captured with the actual text in `verification/adversarial-findings.md`).
3. VS-6 confirms an existing pre-change archive still renders.
4. `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` all pass (no errors) at the end of the change.
5. No new DB columns. No new schema fields. Only `packages/pipeline/src/processors/rank-prompts.ts` and `packages/pipeline/src/processors/recap.ts` (and their tests) are modified.

## 5. Out of scope

- Backfilling recap content on historical archives.
- Changing the `bullets` array length or word budgets.
- Changing the 5-axis ranking scores.
- Changing the digest-level fields.
- UI changes.

## 6. Verification Matrix

| REQ | Verified by |
|-----|-------------|
| REQ-001 | VS-1 |
| REQ-002 | VS-1 |
| REQ-003 | VS-1 (negative grep on existing factual-only wording) |
| REQ-004 | VS-1 |
| REQ-005 | VS-2 |
| REQ-006 | VS-2 |
| REQ-007 | VS-3 |
| REQ-008 | VS-4 |
| REQ-009 | VS-6 |
| REQ-010 | Manual diff inspection — the rest of `RANK_SYSTEM_PROMPT_NO_PROFILE` (axes, digest section) must be byte-identical except for the recap-content block. Captured in `verification/adversarial-findings.md` via `git diff` snippet. |
