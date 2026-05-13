# Tighten Per-Story Content — Design

**Date:** 2026-05-13
**Spec:** `docs/spec/tighten-story-content/`
**Status:** Draft — awaiting approval

## Problem Statement

The newsletter is meant to deliver "the important part of the news ASAP" so an AI practitioner can read the whole digest in **3-4 minutes**. Today each story carries far more content than that budget supports — the reader has to skim past analysis they didn't ask for to find the next headline.

## Current State (measured)

Sampled 6 recent stories from `raw_items.metadata.recap`:

| Field | Avg words | Notes |
|---|---|---|
| `title` (recap) | ~7 | 4-7 word newswire headline |
| `summary` (italic lede) | **50.0** | 1-2 sentences |
| `bullets` ("UNPACKED") | **131.2** | avg 5 bullets × ~26 words each |
| `bottomLine` (pull quote) | **28.3** | 1 sentence |
| **Per story total** | **~218** | |

At 200 WPM (the constant in `readingTime.ts`) and ~8 stories per digest:
**~1,740 words ≈ 8.7 minutes** — **more than 2× the target.**

The heaviest cut target is `bullets`: 60% of per-story content, 5 bullets at ~26 words each. Bullets read like a second summary in disguise rather than a 5-second scan.

## Target

3-4 min total read for 5-10 stories at 200 WPM = **600-800 words total**.
With **8 stories**, the per-story budget is **~75-100 words**.

## Research — How Fast-Read Newsletters Do It

(Detailed findings: web research log saved separately. Highlights below.)

| Newsletter | Per-story words | Structure |
|---|---|---|
| **TLDR** | ~55-70 | Headline → 2-3 sentence paragraph. No bullets, no takeaway. |
| **Superhuman AI** | ~80-120 | Headline → 1-2 sentence body → 1 implication line. |
| **Axios "Smart Brevity"** | ≤200 (ceiling) | Headline (≤6 words) → 1 lede → bold "Why it matters" (1-2 sent) → optional bullets. |
| **The Rundown AI** | ~100-150 | Headline → lede → 3 bullets → "why it's a big deal" line. |
| **Stratechery** *(contrast)* | 1,500-3,000 | One topic per issue. Do **not** copy for a digest. |

**Convergent industry median for a 3-4 min, multi-story digest:**

- Headline: 4-7 words
- Lede: 1 sentence (~20-25 words)
- Bullets: **3** items, ~10-15 words each (~30-45 words total)
- Bottom line: 1 sentence (~15-25 words)
- **Per-story total: ~80-110 words**

Axios is the only outlet treating "why it matters" as mandatory. TLDR omits it entirely. We currently have it as `bottomLine` and a separate `bullets` — that's analysis-on-analysis. The industry pattern is **either bullets OR bottom line, rarely both at full length.**

## Key Insight

The problem isn't the *shape* of our recap schema (lede / bullets / bottom-line is a strong skim hierarchy). The problem is **each part is sized for an essay, not a digest**:

- `summary` (50w) is fine — already ~1-sentence ledes territory.
- `bullets` (131w / 5 items) is the offender — should be **3 bullets × 12 words = ~36 words**, a **73% cut**.
- `bottomLine` (28w) is fine — already 1 sentence.

A ~218 → ~100 word story is mostly a **bullets shrink**, with minor `summary` tightening. No schema removal needed — just budget enforcement at the source (the rank prompt).

## Approaches Considered

### A. Prompt-only tightening (Recommended)

Update `RANK_SYSTEM_PROMPT_NO_PROFILE` to specify:
- `summary`: **1 sentence, ≤25 words** (down from "1-2 sentences").
- `bullets`: **exactly 3, ≤15 words each, ~12 average** (down from "3-5 plain-text analysis points").
- `bottomLine`: **1 sentence, ≤25 words** (clarify cap).
- Add: "Total per story under 100 words. If you're writing a second summary in the bullets, cut. Bullets are facts/numbers, not analysis."

Add **post-generation validation** in `rank.ts`: a soft check that logs `WARN` when a story exceeds 130 words, so we can monitor drift without failing the run. The Zod schema stays permissive (no hard min/max) so we don't blow up old data.

**Pros:** Smallest blast radius. Schema unchanged → all existing archives still render. No DB migration. No UI changes. Reversible by reverting the prompt.

**Cons:** Quality depends on LLM compliance with word caps. Mitigated by:
(a) examples in the prompt (1 actual short example per field),
(b) post-gen length logging,
(c) reviewer can hand-edit in `/admin/review/:runId` as today.

**Effort:** ~1-2 hour change in `rank-prompts.ts` + small length-check in `rank.ts`.

### B. Schema simplification (drop `bullets` entirely, TLDR-style)

Remove `bullets` from the recap entirely. Each story = headline + 1-paragraph summary (~3 sentences, ~70 words) + bottomLine.

**Pros:** Most aggressive tightening. Matches TLDR's known-good 5-min format.

**Cons:**
- Breaking change. Existing archives lose their "UNPACKED" section in the UI/email — either silently empty or we keep a fallback render path for old data.
- Removes a useful skim-affordance (the em-dash bullets are scannable in <3s; a paragraph isn't).
- Many readers *use* the bullets as the primary content and skip the summary; pulling the rug is risky pre-feedback.

### C. Reader-selectable density (toggle short ↔ deep)

Generate both a "short" version (lede + bottom line, ~50 words) and a "deep" version (current ~218). Default to short; expand on click.

**Pros:** Has-cake-eats-cake. Power readers can dive in.

**Cons:**
- Doubles LLM cost per story (or requires summarizing-the-summary at render time).
- New UI states (expand/collapse), new email fallback (email has no JS).
- For 5 readers (Ritesh, Aman + 3) this is overkill. Wait for usage signal before building toggles.

### Recommendation: **Approach A.**

Smallest reversible change, hits the 100-words-per-story target if the LLM follows the new prompt, keeps the existing skim hierarchy, and zero migration risk. If A doesn't tighten enough after a few real runs, B becomes the obvious next step with the data to justify it.

## Chosen Approach — Concrete Changes

### 1. `packages/pipeline/src/processors/rank-prompts.ts`

Replace lines 20-24 (the "For each ranked item, also produce:" block) with a tighter spec that includes word caps, a per-field "what good looks like" example, and the 100-word total budget.

New block (exact text to land):

```
For each ranked item, also produce — write for a 3-minute total read across 8 stories,
so each story must stay under ~100 words across all four fields combined:

- title: A 4-to-7-word neutral newswire headline. Sentence case. Names actor + action.
  No clickbait, no questions, no editorial framing. Aim for ~50 characters.
  Good: "OpenAI ships GPT-5 with native tool use"

- summary: One sentence stating WHAT happened. ≤25 words. Fact-first, names + numbers.
  No analysis here — analysis goes in bullets/bottomLine.
  Good: "OpenAI released GPT-5 today with a 400K-token context window and native tool use."

- bullets: Exactly 3 short bullets, ≤15 words each (~12 avg). Each bullet is a
  scannable FACT — a number, a name, a capability, a comparison. NOT a second
  summary in disguise. NOT analysis. If two bullets say similar things, cut one.
  Good: "— Outperforms GPT-4o by 18% on SWE-bench Verified.
         — Pricing: $5/M input, $15/M output — half of Claude Opus.
         — Tool-use is native; no JSON schema scaffolding required."

- bottomLine: One sentence, ≤25 words, the strategic so-what. This is the only
  place analysis lives.
  Good: "GPT-5's native tool use closes the agent gap with Claude and makes
  schema-wrapping libraries largely obsolete."

Hard ceiling: if your draft exceeds 110 words across these four fields, cut bullets
first (drop the weakest), then trim the summary, then the bottomLine. Never pad to fill.
```

### 2. `packages/pipeline/src/processors/rank.ts` — soft length monitoring

After `generateObject` returns, add a length check (no throw — log only):

```typescript
for (const r of result.object.ranked) {
  const totalWords =
    countWords(r.summary) +
    r.bullets.reduce((n, b) => n + countWords(b), 0) +
    countWords(r.bottomLine);
  if (totalWords > 130) {
    logger.warn(
      { rawItemId: r.id, totalWords, bullets: r.bullets.length },
      "rank.recap.over_budget",
    );
  }
}
```

Where `countWords` is the same `wordCount` already used in `readingTime.ts` — extract to a tiny helper in `shared/utils` (or duplicate locally; it's a one-liner).

### 3. No schema change

- Zod schema in `rank.ts` stays as-is (`bullets: z.array(z.string())` — permissive).
- DB shape (`raw_items.metadata.recap`) unchanged.
- React components (`ArchiveStoryCard.tsx`, `ReviewCard.tsx`) and email template (`newsletter.tsx`) unchanged — they render whatever's in the data, so shorter content just renders shorter naturally.
- No migration needed. Old archives keep their existing (longer) content.

### 4. Surface the reading-time budget in the prompt (telemetry)

Add to the bottom of the new prompt block: *"The reader has set a 3-4 minute total read budget across all stories. Treat per-story brevity as a hard quality bar."* This frames the cap as a reader-experience requirement, not an arbitrary limit.

### 5. (Optional, separately gated) Display the reading-time chip

`readingTimeMinutes` is computed but I haven't confirmed it's surfaced in the UI. If not surfaced, add it to the `ArchivePage` header and the email preheader as a small "5 min read" chip — makes the budget visible to the reader. This is a small follow-on, not part of the core change.

## Edge Cases & Risks

| Risk | Mitigation |
|---|---|
| LLM ignores word caps occasionally | `WARN` log catches outliers; reviewer can shorten in `/admin/review`. After 2 weeks of runs we have data to decide if a stricter post-process truncation is warranted. |
| Old archives still render long-form bullets | Acceptable. Tightening applies forward only. Manual `PATCH /api/admin/archives/:runId` can shorten retroactively if desired. |
| 3 bullets is too few for a major story (e.g. model launch with many specs) | The prompt allows the LLM to choose strong facts; reviewer can add a bullet in the review UI. We're optimizing for the average, not the headline launch. |
| Reviewer adds bullets back during curation and pushes back over budget | Out of scope — that's a reviewer-discipline issue. Optionally show a word-count meter in `ReviewCard` (follow-up). |
| Stage-1 model (`claude-haiku-4-5-20251001`) may comply less reliably than larger models | Haiku has been reliable with explicit word caps in this codebase already (titles work). Monitor `over_budget` warn rate after rollout. |
| Per-story AI title work-in-progress on this branch | This change adds onto the same `rank-prompts.ts` file. Will land as a follow-up commit on the same branch, sequenced after the title precedence work. |

## Verification

1. **Pre-flight (no LLM cost):** Snapshot the new prompt and verify the structure builds and typechecks.
2. **Live recap regeneration:** Run `pnpm dev` against the pipeline, trigger a manual run, inspect 3-5 stories' recap in the DB (via the same psql query used to measure baseline). Expected: avg per-story words 80-110, max <130, bullets count = 3 on every story.
3. **Read-time check:** Open `/archive/<runId>` and confirm it skim-reads in 3-4 min.
4. **Telemetry:** Confirm `rank.recap.over_budget` warns fire only on outliers (target: <10% of stories).

## External Dependencies & Fallback Chain

None — pure-internal feature.

This change touches only:
- A static TypeScript string (the prompt).
- A logger call (already in the codebase).

No new libraries, no new APIs, no external services. The existing Vercel AI SDK + Anthropic Haiku call is unchanged in interface and dependencies. **Library probe is N/A** for this design.

## Open Questions

1. Should `bullets` be **fixed at 3** or **2-3** (allow 2 for thin stories)?
   - Default proposal: **fixed at 3** for visual consistency in the email/archive grid. If the LLM produces a weak third bullet, the reviewer cuts it. Easier to evolve to "2-3" later than to add structure back.

2. Should we update `readingTime.ts` to display a chip in the archive header now, or as a follow-up?
   - Default proposal: **follow-up**. This change is about producing tighter content; surfacing the metric is a separate (very small) PR.

3. Should the prompt explicitly forbid "Why it matters" style phrases inside bullets to prevent analysis creep back into bullets?
   - Default proposal: **yes** — add to the bullets bullet point: *"NOT analysis phrases like 'this signals' / 'this means' — those go in bottomLine."*
