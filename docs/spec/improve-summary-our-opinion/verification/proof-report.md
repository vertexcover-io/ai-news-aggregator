# Verification Proof Report — improve-summary-our-opinion

**Verdict: PASSED**

**Date:** 2026-05-20
**Branch:** main (worktree: improve-summary-our-opinion)
**Test count:** 720 executed, 720 passed, 0 failed

---

## Summary

All 5 claims (PHASE1-C1..C5) are verified. No UI surface was changed; no HTTP route was changed; no DB schema was changed. Only `packages/pipeline/src/processors/rank-prompts.ts` and `packages/pipeline/src/processors/recap.ts` (and their tests) were modified.

---

## Evidence by Claim

### PHASE1-C1 — RECAP_VOICE_BLOCK exists, exported, includes editorial-stance directive + DO NOT block + bad/good examples

**Proven by:**
- `rank-prompts.test.ts > editorial-stance recap content (VS-1, VS-2) > VS-1a` — regex `/our (editorial )?(take|stance|voice)/i` matches `RANK_SYSTEM_PROMPT_NO_PROFILE` and context window confirms "before" appears within 300 chars.
- `rank-prompts.test.ts > editorial-stance recap content (VS-1, VS-2) > VS-1b` — "our editorial voice" appears in both the bullets and bottomLine field descriptions.
- `rank-prompts.test.ts > editorial-stance recap content (VS-1, VS-2) > VS-2a` — `DO NOT` block present; `≥3` forbidden patterns matched ("The author argues", "They say", "According to", "revolutionary", etc.).
- `rank-prompts.test.ts > editorial-stance recap content (VS-1, VS-2) > VS-2b` — `≥2` Bad/Good example pairs present (bullets Good: "Pricing held at $5/$15...", bottomLine Good: "Coding-agent buyers...").
- `rank-prompts.test.ts > editorial-stance recap content (VS-1, VS-2) > RANK_SYSTEM_PROMPT_NO_PROFILE includes RECAP_VOICE_BLOCK verbatim` — `RANK_SYSTEM_PROMPT_NO_PROFILE.includes(RECAP_VOICE_BLOCK)` is true.

### PHASE1-C2 — RANK_SYSTEM_PROMPT_NO_PROFILE includes RECAP_VOICE_BLOCK verbatim AND summary's ORIENT role is preserved

**Proven by:**
- `rank-prompts.test.ts > editorial-stance recap content (VS-1, VS-2) > VS-1c` — `RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase().includes("state what happened")` is true. The summary field description retains its factual ORIENT wording unchanged — it was NOT swept into the voice change.

**Diff evidence:** The only change to `rank-prompts.ts` is:
1. Addition of the new `RECAP_VOICE_BLOCK` constant at the top of the file (exported).
2. The old inline recap-content block in `RANK_SYSTEM_PROMPT_NO_PROFILE` is replaced with `${RECAP_VOICE_BLOCK}`. The 5-axis scoring section, digest block, source-neutrality rule, reader-persona section, boost/downrank guidance, dedup rules, and hard-ceiling section are byte-identical to `main`.

### PHASE1-C3 — RECAP_SYSTEM_PROMPT includes RECAP_VOICE_BLOCK verbatim

**Proven by:**
- `recap.test.ts > editorial-stance prompt (VS-3, VS-4) > VS-3a` — `RECAP_SYSTEM_PROMPT.includes(RECAP_VOICE_BLOCK)` is true.
- `recap.test.ts > editorial-stance prompt (VS-3, VS-4) > VS-3b` — `RECAP_SYSTEM_PROMPT.toLowerCase().includes("state what happened")` is true (regression guard).

**Diff evidence:** `recap.ts` changed only the system prompt string — old inline block replaced with `${RECAP_VOICE_BLOCK}` after a short single-item framing sentence ("You are writing a recap for a single news item in our editorial voice."). The `recapContentSchema`, `generateRecap()` function body, and all other logic are byte-identical to `main`.

### PHASE1-C4 — recapContentSchema shape unchanged

**Proven by:**
- `recap.test.ts > editorial-stance prompt (VS-3, VS-4) > VS-4` — `Object.keys(recapContentSchema.shape).sort()` equals `["bottomLine", "bullets", "summary", "title"]` exactly. No new keys, no removed keys.

### PHASE1-C5 — All pipeline unit tests pass

**Proven by:**
- Full `pnpm --filter @newsletter/pipeline test:unit` run: **68 test files, 720 tests, 0 failures**.

---

## Diff-vs-Main Result

```
rank-prompts.ts:
  + RECAP_VOICE_BLOCK const added (lines 1-37, exported)
  ~ RANK_SYSTEM_PROMPT_NO_PROFILE: old inline recap block replaced with ${RECAP_VOICE_BLOCK}
  = SOURCE_NEUTRALITY_RULE: unchanged
  = 5-axis scoring section: unchanged
  = reader-persona paragraph: unchanged
  = boost/downrank guidance: unchanged
  = dedup rules: unchanged
  = hard-ceiling / digest / social sections: unchanged

recap.ts:
  + import RECAP_VOICE_BLOCK from rank-prompts.js
  ~ RECAP_SYSTEM_PROMPT: old inline block replaced with ${RECAP_VOICE_BLOCK}
  = recapContentSchema: unchanged
  = generateRecap() body: unchanged
  = RecapInputItem interface: unchanged
```

The `git diff main -- packages/pipeline/src/processors/rank-prompts.ts packages/pipeline/src/processors/recap.ts` output confirms: only the recap-content section and the new constant addition differ. The 5-axis block (`Developer-relevance`, `Builder-impact`, `Agentic-systems-relevance`, `Evidence-quality`, `Signal-vs-hype`), the digest block, the SOURCE_NEUTRALITY_RULE, and all other sections show no `+` or `-` lines.

---

## Adversarial Walkthrough: Vendor Blog Editorial-Stance Scenario

**Scenario:** A vendor blog post says: "Our new model represents a quantum leap in reasoning, setting a new standard for the industry."

**Prompt trace with the new RECAP_VOICE_BLOCK:**

1. The model is instructed to "internally draft our editorial take on this story: is it important, is it overhyped, is it derivative, does it move the field, who benefits, who is being sold to." This forces the model to evaluate whether the "quantum leap" claim is substantiated by the source body before writing anything.

2. The `DO NOT` block explicitly prohibits:
   - "Lift descriptive adjectives the source uses about itself (e.g. if a vendor blog calls the release 'revolutionary', do not repeat that word)" — this directly applies to "quantum leap."
   - "Paraphrase the source's thesis when the source IS the protagonist."
   - "Treat the source's claims as our conclusion — they are inputs to our judgment."

3. The `bottomLine` description reads: "Must be our take, not a paraphrase of the source's own conclusion." The Bad example: "This is a major leap for Anthropic and shows the company's commitment to safety." is a direct structural analog to the vendor's self-description.

4. **Expected after-prompt behavior:** Bullets would extract concrete facts (e.g., what benchmark was cited, what specific capability improved, which tasks are affected) rather than echoing "quantum leap." The bottomLine would state our judgment (e.g., "The 12% SWE-bench gain is real but the 'industry-standard' claim rests on one self-run eval") rather than the vendor's positioning.

5. **Conclusion:** The prompt structure makes it structurally harder for the model to echo vendor self-description, because it must: (a) form a stance from facts first, (b) pass through DO NOT checks, and (c) match the Bad example pattern to catch self-description paraphrase. The instruction is clear and actionable.

---

## Test Names (All 9 New Tests)

From `rank-prompts.test.ts`:
1. `rank prompts > editorial-stance recap content (VS-1, VS-2) > VS-1a: contains editorial-stance directive near 'before' or 'first' (REQ-001)`
2. `rank prompts > editorial-stance recap content (VS-1, VS-2) > VS-1b: voice claim appears in bullets and bottomLine field descriptions (REQ-003, REQ-004)`
3. `rank prompts > editorial-stance recap content (VS-1, VS-2) > VS-1c: summary description still contains 'state what happened' (REQ-002 — positive regression guard)`
4. `rank prompts > editorial-stance recap content (VS-1, VS-2) > VS-2a: prompt contains a DO NOT block with at least 3 forbidden patterns (REQ-005)`
5. `rank prompts > editorial-stance recap content (VS-1, VS-2) > VS-2b: prompt contains at least 2 Bad/Good example pairs (REQ-006)`
6. `rank prompts > editorial-stance recap content (VS-1, VS-2) > RANK_SYSTEM_PROMPT_NO_PROFILE includes RECAP_VOICE_BLOCK verbatim (REQ-001..REQ-006)`

From `recap.test.ts`:
7. `editorial-stance prompt (VS-3, VS-4) > VS-3a: RECAP_SYSTEM_PROMPT includes RECAP_VOICE_BLOCK verbatim (REQ-007)`
8. `editorial-stance prompt (VS-3, VS-4) > VS-3b: summary description still contains 'state what happened' (REQ-002 regression guard)`
9. `editorial-stance prompt (VS-3, VS-4) > VS-4: recapContentSchema shape is exactly { title, summary, bullets, bottomLine } (REQ-008)`

---

## VS-5 and VS-6 Coverage

**VS-5 (adversarial behavioral check):** Covered above in the vendor-blog walkthrough. No live LLM run was executed as services are not running. The structural analysis of the prompt against the specific forbidden patterns is the verification mechanism. See `adversarial-findings.md` for the full adversarial pass.

**VS-6 (existing archives unaffected):** No code path for reading or rendering archived recap data was modified. The change is prompt-string-only: no DB schema change, no `hydrateRankedItems` change, no API route change, no frontend change. Pre-change archives continue to render their stored `recap.title`, `recap.summary`, `recap.bullets`, `recap.bottomLine` values unchanged.
