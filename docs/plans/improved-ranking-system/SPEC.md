# SPEC: Improved Ranking System

**Source:** docs/plans/2026-04-10-improved-ranking-design.md
**Generated:** 2026-04-10

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When candidates are loaded, the system shall drop items whose titles match per-source noise patterns before any embedding or LLM call | Items matching patterns ("Ask HN:", "Who is hiring?", etc.) are absent from all downstream stages; input/output counts logged | Must |
| REQ-002 | Event-driven | When candidates are loaded, the system shall drop items whose engagement is below the minimum threshold for their source type before any embedding or LLM call | Items with points+commentCount below per-source threshold absent from downstream; threshold constants configurable in code | Must |
| REQ-003 | Event-driven | When pre-filtered candidates are processed, the system shall embed all candidate titles in a single batch call to Voyage AI | A single `embedBatch` call is made with `inputType:"document"` for all candidate titles; no per-item calls | Must |
| REQ-004 | Event-driven | When title embeddings are computed, the system shall group candidates into duplicate clusters where any two titles have cosine similarity > 0.8 | Clusters contain all candidates whose title vectors are mutually within the 0.8 cosine threshold; single-item clusters contain exactly one candidate | Must |
| REQ-005 | Event-driven | When a duplicate cluster contains more than one candidate, the system shall sum `points` and `commentCount` across all cluster members into the representative's engagement | Representative's `engagement.points` equals the sum of all cluster members' points; same for `commentCount` | Must |
| REQ-006 | Event-driven | When a duplicate cluster contains more than one candidate, the system shall select as representative the member with the most comments, breaking ties by longest content length | Representative is the item with `comments.length` highest; ties broken by `content?.length ?? 0` descending | Must |
| REQ-007 | Event-driven | When a duplicate cluster contains more than one candidate, the system shall assign the highest source authority weight among all cluster members to the representative | Representative's effective authority = `max(authorityWeight(m.sourceType) for m in cluster)` | Must |
| REQ-008 | Event-driven | When a single-item cluster is processed, the system shall pass the candidate through unchanged with its original engagement | Output candidate is referentially equal to input; engagement values unmodified | Must |
| REQ-009 | Event-driven | When shortlisting with a profile, the system shall reuse the title embeddings from the semantic dedup stage rather than making a second Voyage embed call for titles | Topic embeddings are fetched via Voyage; title embeddings come from the pre-computed dedup batch; total Voyage calls = 2 per run (dedup titles + profile topics) | Must |
| REQ-010 | Event-driven | When shortlisting, the system shall score each candidate using HN-style gravity recency: `1 / (ageHours + 2)^1.5` | Gravity score for a candidate published exactly 0h ago is `1/(0+2)^1.5 = 0.354`; for 22h ago is `1/24^1.5 ≈ 0.0085` | Must |
| REQ-011 | Ubiquitous | The system shall apply recency exactly once per run, in the 4-signal fusion stage | No recency factor is multiplied into LLM scores or shortlist scores separately; only the final fusion uses recency | Must |
| REQ-012 | Event-driven | When a profiled run reaches the LLM rank stage, the system shall ask the LLM to score each item 1–5 on four axes: relevance, novelty, signal-vs-hype, and actionability | LLM response schema includes `{ relevance: number, novelty: number, signalVsHype: number, actionability: number }` each in [1,5] | Must |
| REQ-013 | Event-driven | When a profile-less run reaches the LLM rank stage, the system shall ask the LLM to score each item 1–5 on three axes: novelty, signal-vs-hype, and actionability (no relevance axis) | LLM response schema includes `{ novelty: number, signalVsHype: number, actionability: number }` each in [1,5]; no relevance field | Must |
| REQ-014 | Event-driven | When LLM axis scores are returned, the system shall compute the LLM signal as the mean of provided axis scores divided by 5, producing a value in [0,1] | `llmSignal = mean(axes) / 5`; for axes [3,4,5,2] the result is `(3+4+5+2)/(4×5) = 0.70` | Must |
| REQ-015 | Event-driven | When LLM axis scores are returned, the system shall include a CoT rationale field that names the dominant scoring axis | Each LLM response entry contains a non-empty `rationale` string mentioning at least one axis name | Must |
| REQ-016 | Event-driven | When post-LLM quality gate runs, the system shall drop any item whose mean axis score is less than 2.0 | Items with mean axis score < 2.0 are absent from fusion input; items with mean ≥ 2.0 are retained | Must |
| REQ-017 | Unwanted | If the post-LLM quality gate would drop all items, then the system shall retain the single item with the highest mean axis score | At least one item always reaches MMR selection; the retained item is the one with max mean axis score | Must |
| REQ-018 | Event-driven | When computing the engagement signal, the system shall normalize per source type: `log(1 + merged) / log(1 + sourceTypeMax)`, clamped to [0,1] | HN sourceTypeMax=2000, Reddit=10000, blog=0; blog posts always produce engagement signal=0 | Must |
| REQ-019 | Event-driven | When computing the authority signal, the system shall use static weights: blog=1.0, reddit=0.85, hn=0.75 | Authority values are exactly these three constants; cross-source merged items use the max weight of any member | Must |
| REQ-020 | Event-driven | When running a profiled run, the system shall compute the final fusion score as: `0.40×llm + 0.25×engagement + 0.20×recency + 0.15×authority` | For llm=0.8, engagement=0.5, recency=0.3, authority=1.0: score = 0.32+0.125+0.06+0.15 = 0.655 | Must |
| REQ-021 | Event-driven | When running a profile-less run, the system shall compute the final fusion score as: `0.50×llm + 0.30×engagement + 0.20×recency` (no authority signal) | For llm=0.8, engagement=0.5, recency=0.3: score = 0.40+0.15+0.06 = 0.61 | Must |
| REQ-022 | Event-driven | When MMR selection runs, the system shall greedily select items using MMR with λ=0.7: `score = 0.7×fusionScore - 0.3×maxSimilarity(item, alreadySelected)` | First selected item is always the highest fusion score; each subsequent item maximises the MMR expression | Must |
| REQ-023 | Event-driven | When MMR selection runs with profile embeddings available, the system shall use cosine similarity between title embeddings for item-to-item similarity | Title embeddings from the semantic dedup stage are reused; no additional embedding calls made | Must |
| REQ-024 | Event-driven | When MMR selection runs in profile-less mode, the system shall use title bigram Jaccard similarity as the item-to-item similarity proxy | Jaccard similarity computed on unigram+bigram token sets of the two titles | Should |
| REQ-025 | Event-driven | When MMR selection runs, the system shall enforce a source cap of at most 3 items per source type in the final output | No sourceType appears more than 3 times in the final top-N list | Must |
| REQ-026 | Ubiquitous | The `RankedItemRef` stored in Redis shall include a `score` field in [0,1] representing the fusion score | All `score` values in the persisted rankedItems are between 0 and 1 inclusive | Must |
| REQ-027 | Ubiquitous | The `RankedItemRef` stored in Redis shall include an `axisScores` field with the raw per-axis LLM scores | `axisScores` contains the exact values returned by the LLM for each axis; type matches design spec shape | Should |
| REQ-028 | Ubiquitous | The `RunProcessJobData` payload shape shall remain unchanged | No new required fields added to `RunProcessJobData`; existing API and frontend compile and run without modification | Must |
| REQ-029 | Event-driven | When any new pipeline stage (noise filter, semantic dedup, MMR) runs, the system shall log structured events with `inputCount`, `outputCount`, and `durationMs` | Each stage emits at minimum one `logger.info` event with those three fields on completion | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | All candidates match noise patterns | Pre-filter drops all items; empty array returned; run completes with `rankedItems: []` and a warning | REQ-001, REQ-002 |
| EDGE-002 | All candidates have 0 engagement | Engagement signal is 0 for all; LLM and recency signals still differentiate items | REQ-018 |
| EDGE-003 | Blog post merged with HN story in same cluster | Representative gets `authority=1.0` (blog wins); merged engagement = HN points + blog points | REQ-007, REQ-019 |
| EDGE-004 | Two items with identical titles (cosine=1.0) | Cluster formed; engagement merged; representative is richer-metadata item | REQ-004, REQ-005, REQ-006 |
| EDGE-005 | Two items with unrelated titles (cosine=0.2) | Not clustered; both pass through as separate candidates | REQ-004 |
| EDGE-006 | Cosine similarity exactly 0.8 | Not clustered (threshold is strictly >0.8) | REQ-004 |
| EDGE-007 | HN item with 2500 points (above sourceTypeMax=2000) | Normalized engagement = `log(2501)/log(2001)` which exceeds 1.0; clamped to 1.0 | REQ-018 |
| EDGE-008 | Item published in the future (negative age) | `ageHours` clamped to 0; gravity = `1/(0+2)^1.5 = 0.354` | REQ-010 |
| EDGE-009 | Item with `publishedAt: null` | Age defaults to 24h; gravity = `1/(24+2)^1.5` | REQ-010 |
| EDGE-010 | LLM returns axis score outside [1,5] | Schema validation (zod) rejects the response; rank stage throws and run is marked failed | REQ-012, REQ-013 |
| EDGE-011 | LLM returns mean axis = exactly 2.0 | Item is retained (threshold is strictly < 2.0) | REQ-016 |
| EDGE-012 | All items have mean axis < 2.0 | Fallback: item with highest mean axis is retained regardless of threshold | REQ-017 |
| EDGE-013 | Fewer candidates than topN after MMR + source caps | Return however many pass; no padding; API and frontend handle variable-length results | REQ-025 |
| EDGE-014 | All candidates from single source type (e.g. all HN) | Source cap limits to 3 HN items in final output; if topN > 3, remaining slots are empty | REQ-025 |
| EDGE-015 | Empty candidate list after URL dedup (0 items) | Noise filter, semantic dedup, shortlist, rank, MMR all early-exit; run completes with `rankedItems: []` | REQ-001 |
| EDGE-016 | Single candidate after all filtering | Semantic dedup: 1-item cluster, no merge; shortlist: 1 item; MMR: 1 item selected; output has 1 item | REQ-008, REQ-022 |
| EDGE-017 | Profile-less run — relevance axis absent from LLM | LLM prompt omits relevance axis; schema has no `relevance` field; mean computed over 3 axes | REQ-013, REQ-021 |
| EDGE-018 | MMR: two items with identical fusion scores | Tie broken by index order (stable sort) | REQ-022 |
| EDGE-019 | Voyage API call fails during semantic dedup | Stage throws; run is marked `failed`; error logged with structured context | REQ-003 |
| EDGE-020 | Cluster representative has `content: null` | Rank body-loader handles via Jina fetch; no special handling needed in semantic dedup | REQ-006 |

## Verification Matrix

| ID | Unit Test | Integration Test | Manual Test | Notes |
|----|-----------|-----------------|-------------|-------|
| REQ-001 | Yes | No | No | Test noise patterns as pure function; no I/O |
| REQ-002 | Yes | No | No | Test engagement threshold constants per source type |
| REQ-003 | Yes | No | No | Inject mock embedBatch; assert called once with all titles |
| REQ-004 | Yes | No | No | Unit test clustering with controlled cosine values |
| REQ-005 | Yes | No | No | Assert summed engagement on merged cluster |
| REQ-006 | Yes | No | No | Test representative selection with comment/content tie-break |
| REQ-007 | Yes | No | No | Test authority max-of-cluster logic |
| REQ-008 | Yes | No | No | Assert pass-through for single-item cluster |
| REQ-009 | Yes | No | No | Inject pre-computed embeddings into shortlist; assert no second embed call |
| REQ-010 | Yes | No | No | Unit test gravity formula with specific age inputs |
| REQ-011 | Yes | No | No | Assert recency factor absent from shortlist score and LLM score; only in fusion |
| REQ-012 | Yes | No | No | Inject mock generateObject; assert 4-axis schema with profiled run |
| REQ-013 | Yes | No | No | Inject mock generateObject; assert 3-axis schema with no-profile run |
| REQ-014 | Yes | No | No | Unit test mean/5 computation with known axis values |
| REQ-015 | Yes | No | No | Assert rationale string non-empty and contains axis name |
| REQ-016 | Yes | No | No | Unit test quality gate filter with boundary values |
| REQ-017 | Yes | No | No | Unit test fallback when all items below threshold |
| REQ-018 | Yes | No | No | Unit test normalization formula for each source type including clamp |
| REQ-019 | Yes | No | No | Assert authority constants and max-merge logic |
| REQ-020 | Yes | No | No | Unit test fusion formula with known inputs; assert floating point result |
| REQ-021 | Yes | No | No | Unit test 3-signal fusion formula for no-profile case |
| REQ-022 | Yes | No | No | Unit test MMR greedy selection with controlled scores and similarities |
| REQ-023 | Yes | No | No | Inject title embeddings; assert cosine similarity used in MMR |
| REQ-024 | Yes | No | No | Unit test bigram Jaccard with controlled title pairs |
| REQ-025 | Yes | No | No | Unit test source cap enforcement with all-same-source input |
| REQ-026 | Yes | No | No | Assert all score values in [0,1] range in output |
| REQ-027 | Yes | No | No | Assert axisScores field present and matches LLM output |
| REQ-028 | Yes | No | No | Compile check — no new required fields on RunProcessJobData |
| REQ-029 | Yes | No | No | Assert logger.info called with required fields per stage |
| EDGE-001 | Yes | No | No | Pass all-noise input; assert empty output |
| EDGE-002 | Yes | No | No | Pass 0-engagement candidates; assert engagement signal = 0 for all |
| EDGE-003 | Yes | No | No | Cluster blog+HN; assert authority=1.0 and merged engagement |
| EDGE-004 | Yes | No | No | cosine=1.0 cluster; assert single output with merged values |
| EDGE-005 | Yes | No | No | cosine=0.2 pair; assert two separate outputs |
| EDGE-006 | Yes | No | No | cosine=0.8 exactly; assert NOT clustered |
| EDGE-007 | Yes | No | No | points=2500 with HN max=2000; assert clamped to 1.0 |
| EDGE-008 | Yes | No | No | Negative age; assert gravity uses ageHours=0 |
| EDGE-009 | Yes | No | No | publishedAt=null; assert age=24h used |
| EDGE-010 | Yes | No | No | Mock generateObject returning score=6; assert zod throws |
| EDGE-011 | Yes | No | No | mean=2.0 exactly; assert item retained |
| EDGE-012 | Yes | No | No | All means < 2.0; assert highest-mean item retained |
| EDGE-013 | Yes | No | No | Input fewer than topN after caps; assert output length < topN |
| EDGE-014 | Yes | No | No | All-HN input with topN=10; assert output has exactly 3 items |
| EDGE-015 | Yes | No | No | Empty candidate list; assert rankedItems=[] without errors |
| EDGE-016 | Yes | No | No | Single candidate; assert it passes through all stages |
| EDGE-017 | Yes | No | No | No-profile run; assert relevance absent from schema and prompt |
| EDGE-018 | Yes | No | No | Equal fusion scores; assert stable order |
| EDGE-019 | Yes | No | No | Mock embedBatch to throw; assert run fails with structured error log |
| EDGE-020 | Yes | No | No | Cluster representative with content=null; assert passes through dedup unchanged |

## Out of Scope

- Feedback loop: approve/reject signals from the review dashboard are NOT used to adjust rankings. This was explicitly excluded.
- BM25 keyword filtering: no keyword-based pre-filter is added; noise filtering is pattern-based only.
- Real-time weight tuning: fusion weights (0.40/0.25/0.20/0.15) are compile-time constants, not runtime-configurable.
- Per-run weight overrides: no new fields on `RunProcessJobData` for weight customization.
- Summarization stage: generating article summaries is deferred (future PR).
- Review dashboard changes: no UI changes; `RankedItemRef` wire shape is backward compatible.
- Voyage batch chunking: if Voyage enforces a batch size limit below the number of candidates, chunking is deferred; the implementation asserts the limit is not hit.
- Cross-run deduplication: items that appeared in previous digests are not filtered. Dedup is within-run only.
- New source types: this PR does not add new collectors; only HN, Reddit, and blog sources are handled.
