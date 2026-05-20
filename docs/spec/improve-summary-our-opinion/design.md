# Design — Improve Summary Generation: Our Opinion, Not the Source's

**Status:** Draft
**Date:** 2026-05-20
**Branch:** feat/improve-summary-our-opinion
**Linear:** TBD

## 1. Problem

The recap content we generate per ranked item (`summary`, `bullets`, `bottomLine`) is currently derived directly from the scraped source body. The prompt instructs the model to "state what happened, fact-first" — which in practice causes the model to lift the source's own framing and the source author's editorial opinions. The reader sees the source author's voice instead of ours.

The same problem exists in the add-post flow (`processors/recap.ts`), which uses a near-identical prompt for a single newly-added item.

We want the digest to feel like *our* take on the day's stories. The reader is here because they trust *us* to filter and frame, not because they want to hear what the original author of a Reddit post or company blog thinks.

## 2. Goal

Restructure the recap-generation prompts so that the LLM:

1. **First forms our editorial stance** on the story (an internal reasoning step framed inside the prompt).
2. **Then writes** `bullets` and `bottomLine` *through that stance* — every line in those two fields reflects our take, not an echo of the source author's framing or opinion.

`summary` keeps its current factual ORIENT role — one sentence stating what happened, drawn from the source. It is the load-bearing lede on the archive UI and must stay grounded. The shift to "our voice" happens in the interpretive layers (`bullets`, `bottomLine`), which is where opinion belongs anyway.

The output schema (`title`, `summary`, `bullets`, `bottomLine`) is unchanged. No DB migrations. No UI changes. The change is purely in the LLM prompt + a handful of generation-quality tests.

## 3. Non-goals

- No new DB columns, no new recap fields.
- No UI changes — `summary` still renders where it always rendered (italic lede on `/archive/:runId`, list dek on `/`).
- Not changing the ranking axes / 5-axis scoring — only the recap-content portion of the rank prompt.
- Not touching the `digest.headline` / `digest.summary` / `digest.hook` / `digest.twitterSummary` framing — those are already in our voice.
- Not adding a new LLM call. Reuse the existing `generateObject` invocations at the two sites.

## 4. Design

### 4.1 Prompt architecture change

Both prompts (rank-prompts.ts §"recap content" block and recap.ts `RECAP_SYSTEM_PROMPT`) currently say:

> summary = ORIENT. State what happened. Fact-first. No analysis, no implications, no "why it matters".
> bullets = EXPLAIN. ...
> bottomLine = INTERPRET. Answer "so what?" ...

The new architecture has the model do an **explicit editorial-stance step** before writing the four fields. The system prompt will declare:

> Before producing any output fields, internally draft **our editorial take** on this story: is it important, is it overhyped, is it derivative, does it move the field, who benefits, who is being sold to. Form this stance from the facts in the source — never echo the source author's framing or opinion. Then write every output field through this stance.

The fields keep their roles but only the interpretive layers get the *voice* requirement layered on top:

- `summary` — **Unchanged.** One sentence stating what happened, fact-first, drawn from the source. ≤25 words. No analysis, no implication, no voice. This is the load-bearing lede that the `/archive/:runId` UI renders as the italic story lede; it must stay neutral and grounded so the reader has a clean factual anchor before our interpretation lands.
- `bullets` — Three scannable facts (unchanged role) — but **selected through our editorial stance**: the three facts most needed to make our take defensible, in our framing. Forbidden: a bullet that's just a paraphrase of a sentence the source author wrote about their own importance / framing.
- `bottomLine` — One sentence of strategic so-what **in our voice**. This is where our opinion is most explicit. Forbidden: ending up as a softer paraphrase of the source's own conclusion.

### 4.2 Sourcing guard — hard prohibitions with examples

The new prompt block includes an enumerated **DO NOT** list, plus 2 bad/good pairs:

- DO NOT begin with `"The author argues"`, `"They say"`, `"According to <source>"`, `"<source author> writes"`.
- DO NOT lift descriptive adjectives the source uses about itself (e.g. if a vendor blog calls the release "revolutionary", we don't).
- DO NOT paraphrase the source's thesis when the source IS the protagonist (e.g. don't restate Anthropic's positioning of its own product as fact).
- DO treat the source's claims as **inputs** to our judgment, not as our conclusion.

Bad → good examples included verbatim in the prompt (focused on `bullets` and `bottomLine`, since `summary` is unchanged):

> Bad bullet (echoes source's framing): "The release marks an important step forward for the company's AI strategy."
> Good bullet (concrete + our framing): "Pricing held at $5/$15 per M tokens — half of Claude Opus, identical to Haiku 3.5."

> Bad bottomLine (echoes source's conclusion): "This is a major leap for Anthropic and shows the company's commitment to safety."
> Good bottomLine (our voice): "Coding-agent buyers no longer have a clean reason to default to GPT-5; Anthropic just made the pricing decision harder."

### 4.3 Where the change lands

Two files are touched in `packages/pipeline/src/processors/`:

1. `rank-prompts.ts` — the `RANK_SYSTEM_PROMPT_NO_PROFILE` constant's "recap content" section (lines ~40–72 currently). Replace the role descriptions for summary/bullets/bottomLine with the voice-aware versions, prepend the editorial-stance step, and add the DO NOT / examples block.
2. `recap.ts` — the `RECAP_SYSTEM_PROMPT` constant. Same replacement, but stripped to single-item context (no axes, no digest fields). Both prompts must use the **same** voice rules so output stays uniform across the two paths.

No code structure changes. No new exports. No new schema fields.

### 4.4 Why leave `summary` factual

The `summary` field is the italic lede on `/archive/:runId` and the dek on `/`. It carries the reader's only neutral anchor — a concrete one-sentence statement of what happened. If we tilt that into opinion, the reader loses the orient layer entirely and lands in interpretation before they know the fact. The interpretive surface (`bullets` + `bottomLine`) is the right home for our voice. By keeping `summary` factual we get the editorial improvement (opinionated take where opinion belongs) without sacrificing the reader's footing.

### 4.5 Backwards compatibility

The schema (`recapContentSchema` in recap.ts and the rank Zod schema) does not change. Existing reviewed archives in DB are unaffected. Pre-change archives still render with their old summaries — we are not backfilling.

### 4.6 Risk: hallucination

Asking the model to "form our opinion" sounds like an invitation to make things up. Mitigations baked into the prompt:

- The stance step is constrained: it must be **derived from the facts in the source**, and the bullets must remain factual claims (metric / feature / date / name / comparison) — the existing bullet rules already enforce concrete detail. We tighten them: bullets must be facts that *appear in the source*, not invented.
- The DO NOT list explicitly forbids both echoing the source AND inventing claims not present in the source.
- The `temperature: 0` setting in both call sites stays.
- The structured-output schema is unchanged, so any malformed output still fails closed.

### 4.7 Risk: tone drift

If "our voice" becomes too snarky or contrarian, the digest loses authority. The prompt frames our voice as **opinionated but grounded**: confident on judgment, careful with adjectives, no clickbait verbs ("quietly", "finally", "doubles down" — already forbidden in title rules; we extend that ban to summary/bottomLine).

## 5. External Dependencies & Fallback Chain

This change touches only existing prompt strings consumed by libraries already in the stack:

- **Vercel AI SDK (`ai`) + `@ai-sdk/anthropic`** — already used at both call sites via `generateObject`. No version bump. No new provider. No new API surface.
- **Anthropic Claude Haiku 4.5** — already used as the ranking + recap model via `claude-haiku-4-5-20251001`. No model change. Prompt-only edit.

**Fallback chain:** None required. There is no new external dependency; the change is a string replacement inside two source files that the existing live SDK already consumes successfully every run. The library-probe step has nothing to verify — there is no new lib, no new API call, no new field on the SDK response. Probe verdict will be `NOT_APPLICABLE`.

## 6. Verification plan

Unit-level (Vitest, both `processors/rank.ts` and `processors/recap.ts`):

1. **Prompt-shape test** — assert the new prompts contain the editorial-stance instruction, the DO NOT list, and at least one good/bad example. (Cheap regression guard against accidental revert.)
2. **Output-quality test** — feed a fixture source body that carries strong author opinion (e.g. a vendor blog where the company claims its own release is "revolutionary"); stub `generateObject` to record the prompt; assert the prompt contains the voice-aware language so the live model will see it. We do not assert on the LLM's output content (non-deterministic).

End-to-end (manual + adversarial-findings):

3. Run a real rank against a small fixture set, manually inspect 3 summaries / bottomLines for echoes of the source author's framing. Capture in `verification/adversarial-findings.md` with a before/after sample.

No DB tests needed — no schema change.

## 7. Out of scope

- Backfilling old archives' recap content.
- Changing the `bullets` count from 3.
- Changing the per-story word budget (100 words combined).
- Changing the digest-level headline / summary / hook / twitterSummary.

## 8. Open questions

None. Scope is fully clarified from the brainstorming Q&A:

- Approach: rewrite prompt so the model forms our opinion first, then writes through it. No new field, no DB change.
- Sites: both `rank-prompts.ts` and `recap.ts`.
- Strictness: hard prohibition with worked examples.
