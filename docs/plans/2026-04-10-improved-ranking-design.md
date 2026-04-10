# Improved Ranking System — Design

## Problem Statement

The current ranking pipeline has four gaps identified in VER-26:

1. **Dedup is URL-only** — the same story posted on HN, Reddit, and a blog with different URLs creates three separate candidates. Engagement is not merged across sources, so a story that's viral across multiple platforms looks weaker than a single-source spike.
2. **Only two ranking signals** — `LLM score (0–100) × recency decay`. Engagement data exists in the DB but is completely ignored. Source quality is not considered.
3. **No diversity enforcement** — the final list can be all-HN or all-on-one-topic. Pure relevance ranking creates topic monocultures.
4. **No explicit noise filtering** — low-quality items (job postings, meta-threads, thin listicles) rank low but are never actively dropped; they waste LLM context and dilute results.

Additionally, the 0–100 LLM scoring scale is unstable across runs — the same item scores differently on different days because LLMs lack consistent internal calibration at fine-grained scales.

## Context

The pipeline currently runs: collect → URL dedup → Voyage AI embedding shortlist (top-20 by cosine similarity × recency) → Claude Haiku rerank (0–100 score × recency decay again) → final top-N.

Research into production newsletter systems (TLDR, Morning Brew, Artifact, Google News) and open-source aggregators (ArxivDigest, Horizon, auto-news) revealed:
- **5-point LLM scales** substantially outperform 0-100 for cross-run consistency.
- **HN gravity** (`1 / (hours + 2)^1.5`) is less aggressive than exponential decay and produces better recency curves.
- **MMR (Maximal Marginal Relevance)** is the standard approach to diversity-constrained selection.
- **Multi-signal fusion** (relevance + engagement + recency + authority) consistently outperforms any single signal.
- **Semantic dedup** with title embeddings catches cross-URL duplicates that URL canonicalization misses.

## Requirements

### Functional Requirements

1. Semantic deduplication: group candidates whose titles are cosine-similar (> 0.8 threshold) across different URLs.
2. Engagement merging: when a duplicate cluster is detected, sum `points` and `commentCount` across all cluster members. Keep the item with the richest metadata (most comments, then longest content) as the representative.
3. Pre-filter noise: drop items matching known noise patterns before embedding or LLM calls (configurable patterns per source type).
4. Four-signal fusion score: `final = 0.40×llm + 0.25×engagement + 0.20×recency + 0.15×authority`.
5. LLM scoring: 1–5 scale on four axes (relevance, novelty, signal-vs-hype, actionability) with CoT rationale before score. Score is the mean of the four axes.
6. Engagement signal: `log(1 + mergedPoints + mergedCommentCount)`, normalized by source-type max (HN and Reddit have different typical ranges).
7. Recency signal: HN-style gravity `1 / (ageHours + 2)^1.5`, applied **once** only (currently applied twice, creating double exponential).
8. Source authority signal: static per-source-type weight (blog=1.0, reddit=0.85, hn=0.75). Combined sources (after merge) use the highest weight of any member.
9. MMR diversity selection: after 4-signal scoring, select final top-N using MMR (λ=0.7) with source caps (configurable, default max 3 per source type).
10. Post-LLM quality gate: items where mean LLM axis score < 2/5 are dropped before MMR selection.
11. Profile-less runs continue to work: LLM relevance axis is omitted, fusion is 3-signal (llm=0.50, engagement=0.30, recency=0.20 with no authority as all sources treated equally).
12. All new logic is unit-tested with injected dependencies.

### Non-Functional Requirements

- **Latency**: semantic dedup adds one embedding call (title batch). This runs before the existing Voyage call in the shortlist stage — both use Voyage AI. Target: no more than 2× latency increase vs current.
- **Observability**: each new stage logs its input/output counts and duration using the same structured logging pattern as existing stages.
- **Backward compatibility**: the `RunProcessJobData` payload shape does not change; no API or frontend changes required.
- **No new external services**: all changes use Voyage AI (already in stack) for semantic dedup embeddings.

### Edge Cases and Boundary Conditions

- **All items from one source**: MMR diversity + source caps prevent any single source from dominating; pipeline still returns results.
- **Duplicate cluster with no body**: representative item may have `content: null` — body fetching in rank stage already handles this gracefully via Jina.
- **Single-item cluster (no merge needed)**: engagement merging is a no-op; item passes through unchanged.
- **Engagement of 0**: `log(1 + 0) = 0`; the item's engagement signal is 0 but it still participates via LLM and recency signals.
- **No-profile run**: relevance axis dropped from LLM prompt, 3-signal fusion weights applied instead.
- **Empty shortlist after pre-filtering**: existing empty-shortlist early-exit path handles this correctly.
- **LLM returns score < 2 for all items**: all items would be dropped by post-LLM quality gate → shortlist falls back to returning whatever survived (avoid full empty result by falling back if gate would empty the list entirely).
- **Blog post with no HN/Reddit counterpart**: no duplicate cluster, no merge, authority weight applies normally.
- **Cross-source merge with mixed source types**: representative picks highest authority weight among cluster members.

## Key Insights

1. **The double recency decay is the most immediately fixable bug.** Currently `exp(-age/halfLife)` is applied at shortlist AND again as a multiplier on the LLM score. An item published 48h ago gets multiplied by `0.368 × 0.368 = 0.135` — heavily penalizing yesterday's news even if it's high quality. Moving to a single recency application in signal fusion fixes this with zero API changes.

2. **Engagement data is already collected but completely unused.** Every `Candidate` has `engagement: { points, commentCount }`. The fix is to add a normalization function and include it in fusion — no new data needed.

3. **Semantic dedup reuses the existing Voyage AI client.** The `embedBatch` service is already in the stack. The only new logic is: embed titles → cluster by cosine similarity → merge engagement per cluster. No new API keys or services.

4. **MMR doesn't require a separate embedding model.** The similarity function for MMR can reuse the title embeddings already computed during the shortlist stage (Voyage). Or it can use a simpler string-based similarity (Jaccard on title bigrams) to avoid an extra API call. Reusing shortlist embeddings is cleaner.

5. **LLM 1-5 scale requires prompt + schema changes, not architectural changes.** The structured output schema changes from `score: z.number()` to `axes: { relevance?, novelty, signalVsHype, actionability }` each `1-5`. The mean becomes the LLM signal component. The rationale field stays.

## Architectural Challenges

### Challenge 1: Semantic dedup placement
Semantic dedup must run after URL dedup (already done) but needs embeddings. The current pipeline embeds at shortlist time using Voyage AI. If we embed at dedup time too, we run two embedding batches — or we can fold semantic dedup into the shortlist stage where embeddings already exist.

**Resolution:** Fold semantic dedup into a new `dedup` service that runs after URL canonicalization. It calls `embedBatch` on all candidate titles, clusters by cosine similarity, and returns merged candidates. The shortlist stage then embeds the profile topics against the already-merged titles — one title embed batch total (shortlist's own), one dedup batch (new). Two Voyage calls total vs one currently.

### Challenge 2: Engagement normalization across source types
HN posts routinely get 500–2000 points; Reddit posts in AI subs get 1000–10000 upvotes. Raw engagement scores are incomparable across sources. 

**Resolution:** Per-source normalization using a configurable `maxEngagement` constant per source type (HN=2000, Reddit=10000, blog=0). After merging, `normalizedEngagement = log(1 + merged) / log(1 + max)`, clamped to [0, 1]. Blog posts get engagement=0 (they have no voting mechanism) and rely entirely on LLM and authority signals.

### Challenge 3: MMR requires item-to-item similarity
MMR selects items to maximize relevance while minimizing similarity to already-selected items. Computing item-to-item similarity requires either embeddings (expensive) or a proxy.

**Resolution:** Reuse the title embeddings from the shortlist stage (already computed) for MMR similarity. The shortlist stage returns `titleEmbeds` alongside the shortlist. MMR computes cosine similarity on those vectors. No extra API call. In no-profile mode (where we don't embed titles in the shortlist stage), we compute a thin title-bigram Jaccard similarity as a cheaper proxy.

### Challenge 4: LLM schema change and rationale format
Changing from `score: number` to `axes: { relevance?, novelty, signalVsHype, actionability }` changes the zod schema, the prompt, and anything that reads `rankedEntry.score`.

**Resolution:** The new schema returns both the axis scores and a `rationale` string. The mean of provided axes is computed in code (not by the LLM), which keeps the LLM's job simple: rate each axis 1-5, explain the dominant one. The `RankedItemRef` stored in Redis keeps a `score: number` field (now the computed mean × source weight), so the frontend/API hydration layer is unchanged.

## Approaches Considered

### Approach A: Minimal patch — fix the three bugs, don't restructure
Fix the double decay, add engagement to fusion as a simple additive term, add URL dedup for the "same title on different URLs" case using Levenshtein distance on titles. Skip semantic embeddings for dedup, skip MMR.

- **Pro**: minimal code change, low risk of regression.
- **Con**: Levenshtein dedup is brittle (title wording varies across sources). No diversity enforcement. Engagement signal is unnormalized. Doesn't fully satisfy VER-26.

### Approach B: Full redesign — new pipeline stages, embeddings-based dedup, MMR, 4-signal fusion (chosen)
Add semantic dedup (embedding-based), 4-signal fusion with normalized engagement and gravity recency, LLM 1-5 scale, post-LLM quality gate, MMR diversity selection with source caps.

- **Pro**: satisfies all four VER-26 requirements, grounded in production best practices from research, reuses existing Voyage AI client.
- **Con**: more code to write and test, adds a second Voyage API call per run, increases pipeline complexity.

### Approach C: Replace shortlist stage entirely with BM25 + embedding hybrid
Remove the Voyage cosine shortlist. Instead, use a BM25 keyword filter (based on profile topics) combined with the engagement signal to pre-select candidates. Then LLM reranks with MMR.

- **Pro**: avoids embedding cost for shortlist.
- **Con**: BM25 is not in the stack (would need a new library). Profile matching on keywords is less nuanced than cosine similarity. Doesn't leverage the existing Voyage investment. Out of scope for this PR.

## Chosen Approach

**Approach B**, with the following scoping decisions:

- Semantic dedup uses a separate embedding call before shortlist, not folded into it — cleaner separation of concerns.
- Per-source engagement normalization with hardcoded `maxEngagement` constants (HN=2000, Reddit=10000, blog=0).
- MMR reuses title embeddings from the shortlist stage (returned as part of `ShortlistResult`).
- LLM scale changes to 1-5 with per-axis scores. `RankedItemRef.score` stays as a `number` in [0,1] range.
- Signal fusion weights are hardcoded (not per-run configurable): profiled=`{llm:0.40, engagement:0.25, recency:0.20, authority:0.15}`, no-profile=`{llm:0.50, engagement:0.30, recency:0.20}`.
- Source authority: blog=1.0, reddit=0.85, hn=0.75.
- No feedback loop (explicitly excluded).

## High-Level Design

```
raw_items (PostgreSQL)
    │
    ▼
loadCandidatesSince()          ← unchanged
    │
    ▼
URL dedup                       ← unchanged (canonicalizeUrl + keep max engagement)
    │
    ▼
Pre-filter                      ← NEW: noise.ts
  • Drop titles matching noise patterns ("Ask HN:", "Who is hiring?", etc.)
  • Drop items below min engagement threshold per source
    │
    ▼
Semantic dedup                  ← NEW: semantic-dedup.ts
  • embedBatch(titles, {inputType:"document"}) via Voyage AI
  • Cluster by cosine similarity > 0.8 threshold
  • Per cluster: sum engagement, keep richest-metadata representative
  • Returns: merged Candidate[], titleEmbeds[] (reused downstream)
    │
    ▼
Shortlist stage                 ← MODIFIED: shortlist.ts
  • Profile run: embed topics, cosine sim vs pre-computed titleEmbeds
    (no second Voyage call for titles — reuse semantic dedup embeddings)
  • Score = relevance × recencyGravity (gravity replaces exp decay)
  • Returns: shortlist[], breakdowns[], titleEmbeds[] (passed to MMR)
    │
    ▼
Rank stage                      ← MODIFIED: rank.ts + rank-prompts.ts
  • Fetch bodies (unchanged)
  • LLM call: 1-5 per axis (relevance?, novelty, signal-vs-hype, actionability)
    with CoT rationale before scores
  • Post-LLM quality gate: drop items where mean axis < 2.0
  • 4-signal fusion per surviving item:
      engagement = log(1 + merged) / log(1 + sourceMax), clamped [0,1]
      recency    = 1 / (ageHours + 2)^1.5, applied ONCE here
      authority  = per source type weight (blog=1.0, reddit=0.85, hn=0.75)
      llm        = mean(axis scores) / 5, normalized to [0,1]
      score = 0.40×llm + 0.25×engagement + 0.20×recency + 0.15×authority
    │
    ▼
MMR diversity selection         ← NEW: mmr.ts
  • Input: scored items + titleEmbeds from shortlist stage
  • MMR (λ=0.7): greedily select items maximizing relevance - 0.3×similarity
  • Source cap: max 3 items per source type (configurable)
  • Output: final top-N RankedItemRef[]
    │
    ▼
Redis run-state                 ← unchanged
```

### New/modified files in packages/pipeline/src:

| File | Change |
|------|--------|
| `processors/noise.ts` | NEW — pre-filter rules |
| `processors/semantic-dedup.ts` | NEW — embedding-based dedup with merge |
| `processors/mmr.ts` | NEW — MMR diversity selection |
| `processors/rank.ts` | MODIFIED — 1-5 scale, 4-signal fusion, quality gate |
| `processors/rank-prompts.ts` | MODIFIED — prompt for axis scoring |
| `processors/shortlist.ts` | MODIFIED — reuse semantic-dedup embeddings, return them |
| `processors/dedup.ts` | UNCHANGED — URL dedup stays |
| `services/recency.ts` | MODIFIED — add gravity formula alongside exp decay |
| `workers/run-process.ts` | MODIFIED — wire new stages into pipeline |

### Type changes in packages/shared/src/types:

- `ShortlistResult` gains `titleEmbeds: number[][]` for MMR reuse.
- `RankedItemRef.score` stays `number` in [0,1] (normalized, not 0-100).
- `RankedItemRef` gains `axisScores?: { relevance?: number; novelty: number; signalVsHype: number; actionability: number }` for frontend display.

## Open Questions

1. **Voyage embed batch size**: the dedup batch may be 200+ titles. Need to verify Voyage's batch size limit and whether we need chunking. (Investigate before implementing `semantic-dedup.ts`.)
2. **Gravity exponent tuning**: `1.8` is HN's exponent; `1.5` is more lenient. Should we expose this as a configurable parameter or hardcode? Currently leaning toward `1.5` hardcoded.
3. **NoProfile MMR similarity**: without title embeddings from the shortlist stage, we need a fallback for MMR similarity computation. Jaccard on bigrams is the current plan — validate this is good enough.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Second Voyage API call doubles embedding latency | Medium | Medium | Both title batches can be sent concurrently; or fold into one call |
| Semantic dedup threshold (0.8) too aggressive, merges different stories | Low | Medium | Log which items are merged; reviewers can spot misclassifications |
| Semantic dedup threshold too lenient, misses obvious duplicates | Low | Low | URL dedup still catches exact-URL duplicates regardless |
| LLM 1-5 schema change breaks existing tests | High | Low | Tests are unit tests with injected `generateObject` — just update fixtures |
| Post-LLM quality gate too aggressive, drops all items | Low | High | Fallback: if gate would empty the list, return at least top-1 |
| MMR with source caps produces fewer than topN items | Low | Low | Return however many pass; API/frontend handle variable-length lists |

## Assumptions

- Voyage AI `embedBatch` handles batches of 200+ titles without chunking (to verify).
- HN points and Reddit upvotes top out around 2000 and 10000 respectively in the AI/tech space (hardcoded normalization constants). If this proves wrong, the constants can be adjusted.
- The existing `Candidate` type's `engagement.points + engagement.commentCount` is already the merged field for items that came through URL dedup. Semantic dedup adds another merge layer on top.
- Frontend and API hydration layer do not need changes — `RankedItemRef.score` remains a number, just reinterpreted as a normalized [0,1] fusion score rather than a raw LLM output.
