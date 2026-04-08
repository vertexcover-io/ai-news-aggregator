# Ranking Prompt Redesign — Design

**Date:** 2026-04-08
**Scope:** `packages/pipeline/src/processors/rank.ts` — the `rankSystemPrompt` constant and any directly related prompt-surface concerns.
**Status:** Design (pre-implementation)

## Problem Statement

The current ranking prompt is tightly coupled to AI news and lets engagement signals (points, comments) leak into score decisions. Two concrete failure modes:

1. **Inconsistent, low-quality rankings** — the model produces varied scores for similar items and lets fluff slip through.
2. **Engagement bias** — the prompt does not forbid using points/comments as a score driver, and the model over-weights them. High-engagement PR posts rank above lower-engagement substantive content.

The prompt also bakes in AI-specific language ("ML engineers, infra engineers, researchers building LLM applications"), so it will degrade immediately if the pipeline is run against a non-AI source category.

## Context

- Pipeline is the monorepo's `@newsletter/pipeline` package; ranking is a pure processor called from the `run-process` worker.
- Current prompt axes: technical novelty, practical value, signal vs noise. Filter: include anything scoring > 30.
- Model: `gemini-2.5-flash` via Vercel AI SDK `generateObject`.
- Schema: `{ ranked: [{ id, score, rationale }] }` — simple and will not change.
- Candidate payload fields sent to the model: `id, title, url, sourceType, publishedAt, engagement { points, commentCount }`.
- `MAX_CANDIDATES = 100`; when more exist, `capCandidates` keeps the top 100 *by engagement*.

## Requirements

### Functional

- Rank every item passed in (no score-threshold self-filtering).
- Return items ordered by score descending; consumer slices to `topN`.
- Each item gets a 0–100 score and a one-line rationale.
- Use the `id` field verbatim so downstream mapping works.

### Non-functional

- **Topic-agnostic.** Zero domain-specific language. The prompt must work unchanged when the pipeline swaps to a different source category (devops, design, finance, etc.).
- **Minimal.** Short enough to keep token cost and cognitive load low; long enough to be unambiguous.
- **Consistent.** Similar items must get similar scores across runs and across items in the same batch.
- **Robust to engagement noise.** Engagement must not move scores, even implicitly.

### Edge cases

- All candidates are weak → top N still returned (consumer's problem, not the prompt's).
- All candidates are strong → scores should spread across the high bands, not compress to 100.
- A single viral PR post → must score low despite high engagement.
- A low-engagement primary source (e.g. an arXiv link with 2 points) → must not be penalized for being quiet.
- Stale content (old `publishedAt`) → penalized under the novelty axis, not ignored.
- Non-English titles, missing publishedAt → model judges on what it has; no special handling required.

## Key Insights

1. **The three axes the user actually cares about are: Novelty, Signal-vs-Hype, Actionability.** Depth and credibility were explicitly not selected — they can be absorbed into the other three (depth → signal vs hype; credibility → signal vs hype via domain/source cues).
2. **Engagement is the dominant failure mode.** The fix is a strict *negative rule* in the prompt, not removing engagement from the payload — the model still benefits from seeing engagement as context (e.g. "this is being discussed") as long as it is forbidden from scoring on it.
3. **Score anchors drive consistency more than axis decomposition.** A 5-band rubric gives the model a stable frame of reference; asking for per-axis sub-scores adds verbosity without more consistency than anchors alone.
4. **A minimal reader framing is load-bearing.** "Actionable" and "useful" are meaningless without *someone* to be actionable *for*. "A curious technical professional" anchors the judgment without naming a domain.
5. **The prompt should never contain the words AI, ML, LLM, or any specific field.** This is the test of generality.

## Architectural Challenges

### Keeping the prompt minimal while being unambiguous

A rubric with 5 score anchors + 3 axes + an explicit engagement rule is borderline-verbose. The design keeps each section to 2–3 lines and uses concrete anti-examples ("funding announcements", "listicles", "recaps") inline rather than in a separate section.

### Engagement rule placement

The engagement rule is placed *after* the rubric, not before, so the model first internalizes the quality frame, then learns the constraint. Placing it at the top risks the model treating it as the main point.

### Rationale discipline for consistency

The current rationale field is only `z.string().min(1)`, so the model can return anything. The new prompt requires rationales to **name the driving axis** (novelty / signal / actionability). This is a soft constraint but has three benefits:
- Forces the model to self-justify against the rubric, which is a known consistency lever.
- Makes review-time inspection easier for us.
- Catches cases where the model scored an item but cannot articulate why — those cases usually indicate engagement bias.

## Approaches Considered

### Approach A — Holistic score + short rubric (chosen)

Single 0–100 score, rationale must name the driving axis, 5-band rubric anchors, explicit engagement negative rule. Matches the current schema exactly. Minimal and consistent.

### Approach B — Per-axis sub-scores combined in prompt

Ask the model for novelty/signal/actionability sub-scores in the rationale string, then a holistic total. More auditable but adds noise to rationale output and doesn't improve consistency beyond what rubric anchors already deliver.

### Approach C — Strip engagement from the input payload entirely

Removes the temptation to bias on engagement. Cleaner in theory but loses useful context (e.g. the model knowing an item is being actively discussed, which is a weak positive signal for *relevance*, not quality). Also couples the fix to the collector payload shape, which is outside this file.

**Recommendation:** Approach A. It is the smallest change that addresses every failure mode the user identified, and the risk of engagement leakage is controlled by the explicit negative rule rather than by hiding the data.

## Chosen Approach — High-Level Design

### The new prompt (draft)

```
You rank news items for a curious technical professional who wants to stay
informed without wasting time on fluff.

Score each item 0–100 on overall value to this reader, judged on three axes:

1. Novelty — new information, findings, releases, or perspectives. Recaps,
   reposts, and rehashed takes score low.
2. Signal vs hype — substantive content with real detail or primary-source
   authority. Marketing, PR, funding announcements, rebrands, and thin
   launches score low.
3. Actionability — the reader learns or can do something concrete. Gossip,
   drama, and pure entertainment score low.

Score anchors:
- 80–100: strong on all three axes; a reader would thank you for surfacing it.
- 60–79: solid on two axes; worth reading.
- 40–59: mixed; one clear strength, notable weaknesses.
- 20–39: weak overall; mostly noise with a faint signal.
- 0–19: fluff, PR, listicle, or off-topic.

Engagement rules (strict):
- The `engagement` field (points, comments) is context only. High engagement
  does NOT raise the score. Low or zero engagement does NOT lower it.
  A viral PR post still scores low. A quiet primary source can score high.
- Judge the content itself, inferred from the title, url, sourceType, and
  publishedAt.

Output:
- Return every candidate, ranked by score descending.
- Each rationale is one line and must name the driving axis, e.g.
  "strong novelty — first public benchmark of X" or
  "low signal — funding announcement, no technical substance".
- Use the `id` field verbatim.
```

### What does not change

- The zod schema (`rankedResponseSchema`) stays identical.
- The `generateObject` call shape stays identical.
- `capCandidates`, `MAX_CANDIDATES`, `topN`, and all surrounding code stay identical.
- The user payload shape sent in `prompt` stays identical (engagement still included).
- Logging fields stay identical.

### What changes

- `rankSystemPrompt` string is replaced wholesale.
- No code changes outside that constant.

## Open Questions

1. **Candidate capping bias.** `capCandidates` sorts by engagement before slicing to 100. This contradicts the "engagement is not a quality signal" principle whenever there are >100 candidates. Out of scope for this prompt change, but worth a follow-up: consider random sampling, recency-based capping, or raising the cap.
2. **Per-source calibration.** A high-quality HN submission and a high-quality reddit submission may present very differently in the same payload. The generic prompt trusts the model to normalize. If inconsistency persists after this change, we may need to group by sourceType or add a per-source normalization pass.
3. **Tie density.** Removing the >30 self-filter means on slow days the topN will contain low-score items. This is acceptable per the requirements, but if it becomes a quality issue, we can reintroduce a threshold later without changing the prompt shape.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Model still silently biases on engagement | Medium | Medium | Explicit negative rule + rationale must name the driving axis, which surfaces engagement-driven scores during review. |
| Score compression (everything 60–80) | Medium | Low | 5-band rubric with clear 0–19 and 80–100 anchors forces spread. |
| Loss of AI-specific nuance | Low | Low | User explicitly wants topic-agnostic. Tested against the failure modes, not against AI quality. |
| Gemini interprets "curious technical professional" too broadly | Low | Low | Can tighten wording in a follow-up if observed. |
| Rationale format drift (model ignores "name the axis") | Medium | Low | Soft constraint; if enforcement needed later, lift into the zod schema as an enum field. |

## Assumptions

- The ranking model is capable enough to follow a rubric + negative rule without per-example fine-tuning. `gemini-2.5-flash` has been observed to handle similar instructions.
- The pipeline will continue to pass the current payload fields; no upstream changes are assumed.
- "Curious technical professional" is a stable enough reader archetype across the source categories the newsletter will realistically cover.
- Inconsistent scoring in the current prompt is a rubric/constraint issue, not a model-capacity issue. If the new prompt still shows inconsistency, the next lever is per-axis sub-scores or anchor examples — not a model swap.
