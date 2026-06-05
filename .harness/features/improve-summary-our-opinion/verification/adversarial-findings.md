# Adversarial Findings — improve-summary-our-opinion

**Date:** 2026-05-20
**Verdict: NO DEFECTS FOUND**

This document records every attack scenario tried against the prompt change and the result of each. Weaknesses that don't rise to a defect are noted separately.

---

## Attack Scenarios Tried

### Attack 1: Summary description silently shifted into editorial voice

**Scenario:** The voice-change was intended to be scoped strictly to `bullets` and `bottomLine`. A scope drift into `summary` would mean the factual ORIENT role is lost.

**What I checked:** The `RECAP_VOICE_BLOCK` summary field description reads:
> "summary = ORIENT. State what happened. Fact-first. No analysis, no implications, no 'why it matters'."

And the per-field spec: "One sentence stating WHAT happened. ≤25 words. Actor + action + object + important number/name if available. No analysis here; analysis goes in bottomLine."

The Bad example for summary: "OpenAI's release shows the race for agentic tooling is heating up." — this is editorial analysis, which the prompt explicitly bans from summary. The Good example is purely factual.

**Also checked:** VS-1c test asserts `RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase().includes("state what happened")`. VS-3b does the same for `RECAP_SYSTEM_PROMPT`. Both pass.

**Result:** No defect. Summary retains its factual ORIENT role. The voice-shift is cleanly scoped to bullets + bottomLine only.

---

### Attack 2: 5-axis scoring / digest / source-neutrality sections drifted

**Scenario:** A refactor that moves the recap block could accidentally trim or alter adjacent sections.

**What I checked:** `git diff main -- packages/pipeline/src/processors/rank-prompts.ts` shows:
- `SOURCE_NEUTRALITY_RULE` constant: unchanged (no `+`/`-` lines).
- 5-axis scoring block (Developer-relevance, Builder-impact, Agentic-systems-relevance, Evidence-quality, Signal-vs-hype): unchanged.
- Reader-persona paragraph: unchanged.
- Boost/downrank guidance: unchanged.
- Dedup / same-event-coverage rules: unchanged.
- Digest block (headline, summary, hook, twitterSummary): unchanged.
- Hard-ceiling guidance: unchanged.

The only changed lines in `rank-prompts.ts` are: (a) the new `RECAP_VOICE_BLOCK` constant prepended at the top, and (b) the old inline recap block replaced with `${RECAP_VOICE_BLOCK}`.

Existing tests guard this: `SOURCE_NEUTRALITY_RULE` verbatim test, 5-axis names test, boost/downrank test, dedup test, hard-ceiling test all still pass (part of the 711 pre-existing tests).

**Result:** No defect. Zero drift in any adjacent section.

---

### Attack 3: DO NOT list missing an obvious editorial-voice-failure pattern

**Scenario:** The DO NOT block might omit a pattern that a real LLM would still produce — e.g., echoing the source's framing using synonyms ("landmark", "pivotal", "groundbreaking") rather than the explicitly banned adjectives.

**What I found:** The DO NOT block says:
> "Lift descriptive adjectives the source uses about itself (e.g. if a vendor blog calls the release 'revolutionary', do not repeat that word)"

This is a *principle* (do not lift the source's own self-descriptions) illustrated with one example. It does NOT enumerate every possible adjective ("landmark", "pivotal", "groundbreaking"). A model could technically comply with the literal rule while still using non-banned but equally promotional synonyms not present in the example.

**Severity assessment:** Weakness, not a defect. The rule targets the pattern (lifting self-applied adjectives) not a specific word list. A well-calibrated LLM will generalize the principle. The instruction "Form this stance from the facts in the source — never echo the source author's framing or opinion" adds a broader stance-based constraint that covers synonyms implicitly.

**Assessment:** Observed weakness. Not a defect. Document for future iteration: consider adding a second example with a different adjective class (e.g., "landmark") to reinforce the generalization.

---

### Attack 4: RECAP_VOICE_BLOCK duplicated / drift risk between rank-prompts.ts and recap.ts

**Scenario:** If the block were copied rather than shared, future edits to one would silently diverge from the other.

**What I checked:** `recap.ts` imports `RECAP_VOICE_BLOCK` from `rank-prompts.ts` via:
```typescript
import { RECAP_VOICE_BLOCK } from "@pipeline/processors/rank-prompts.js";
```
The `RECAP_SYSTEM_PROMPT` is built as:
```typescript
`You are writing a recap for a single news item in our editorial voice.\n\n${RECAP_VOICE_BLOCK}\n`
```

There is no copy. The constant is imported and interpolated. VS-3a test asserts `RECAP_SYSTEM_PROMPT.includes(RECAP_VOICE_BLOCK)` which would fail if the import were removed or the block was re-inlined differently.

**Result:** No defect. Single-source-of-truth design is correctly implemented.

---

### Attack 5: Tautological tests (e.g., checking a constant equals itself)

**Scenario:** A test that asserts `RECAP_VOICE_BLOCK.includes(RECAP_VOICE_BLOCK)` would always pass and prove nothing. Such tests pass the count but provide no real coverage.

**What I checked:** Every new test was read in full:
- VS-1a: Regex match on `RANK_SYSTEM_PROMPT_NO_PROFILE` (not self-referential).
- VS-1b: Checks presence of voice-claim language in substrings of `RANK_SYSTEM_PROMPT_NO_PROFILE`.
- VS-1c: Checks `"state what happened"` in `RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase()` — regression guard, not self-check.
- VS-2a: Checks forbidden patterns in `RANK_SYSTEM_PROMPT_NO_PROFILE`.
- VS-2b: Counts `Bad` and `Good` occurrences in `RANK_SYSTEM_PROMPT_NO_PROFILE`.
- RECAP_VOICE_BLOCK verbatim test: Asserts `RANK_SYSTEM_PROMPT_NO_PROFILE.includes(RECAP_VOICE_BLOCK)` — this would fail if the interpolation were removed from the prompt template.
- VS-3a: Asserts `RECAP_SYSTEM_PROMPT.includes(RECAP_VOICE_BLOCK)` — same: would fail if import removed.
- VS-3b: Checks `"state what happened"` in `RECAP_SYSTEM_PROMPT`.
- VS-4: Checks exact key set of `recapContentSchema.shape`.

**Result:** No tautological tests found. Each test exercises a real invariant that could plausibly fail if the implementation regressed.

---

### Attack 6: bullets + bottomLine voice rules too vague to constrain output

**Scenario:** The voice rules might be so broad ("in our editorial voice") that the model ignores them in practice — effectively a no-op change.

**What I checked:** The prompt provides multiple concrete constraining mechanisms:
1. **Stance-first pre-writing step:** "Before writing any output fields, internally draft our editorial take..." — forces a deliberate evaluation before any text is written.
2. **Explicit Bad examples:** The bullets Bad example ("The release marks an important step forward for the company's AI strategy.") is the canonical form of the failure pattern. The bottomLine Bad example mirrors this. Bad examples are more instructive for avoidance than Good examples alone.
3. **DO NOT block:** Enumerates six distinct failure modes with specifics.
4. **Summary-first isolation:** By keeping `summary` strictly factual and labeling it ORIENT, the model has a clear partition: facts go in summary, our judgment goes in bullets/bottomLine. This makes the editorial voice localized and thus easier to apply consistently.

**Assessment:** The rules are concrete enough to move a model's behavior. The combination of: stance-first instruction + two Bad examples showing exactly the failure pattern + DO NOT block with six specifics is materially stronger than the prior prompt which had no editorial-stance directive, no DO NOT block, and only Good examples.

**Observed weakness (not a defect):** The bottomLine Good example ("Coding-agent buyers no longer have a clean reason to default to GPT-5; Anthropic just made the pricing decision harder.") demonstrates a competitive-comparison take. But stories where there is no obvious competitive comparison might still produce generic bottomLines ("This is worth watching for teams using X"). A future iteration could add a second bottomLine Good example for a non-comparison scenario to cover that pattern.

---

## REQ-010 Coverage: 5-axis + digest sections unchanged

The `git diff main` output was examined line by line. The following sections in `RANK_SYSTEM_PROMPT_NO_PROFILE` show zero changed lines:
- 5-axis scoring block and their descriptions
- Digest block (headline, summary, hook, twitterSummary) and their examples
- SOURCE_NEUTRALITY_RULE interpolation line
- Hard-ceiling / cut-order paragraph

**Result:** REQ-010 satisfied.

---

## Summary Table

| Attack | Description | Result |
|--------|-------------|--------|
| 1 | Summary description shifted into editorial voice | No defect — ORIENT wording intact, tests guard it |
| 2 | 5-axis / digest / source-neutrality sections drifted | No defect — byte-identical per git diff |
| 3 | DO NOT list missing obvious patterns (synonym adjectives) | Weakness only — principle covers the class, one example may not generalize for all models |
| 4 | RECAP_VOICE_BLOCK duplicated (drift risk) | No defect — import + interpolation design, no copy |
| 5 | Tautological assertions in new tests | No defect — each test exercises a real invariant |
| 6 | Voice rules too vague to constrain model | Weakness only — three-layer constraint system is concrete; bottomLine non-comparison scenario under-exampled |

**Total defects found: 0**

---

## VS-6: Existing Archives Unaffected

No code path for reading, hydrating, or rendering archived recap data was modified. `hydrateRankedItems`, the public archive route, the admin review route, and the `rankedItems` DB column are all untouched. Pre-change archives will continue to render their stored `recap` values exactly as before. This path cannot regress from a prompt-string-only change.
