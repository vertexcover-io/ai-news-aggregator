# Library Probe: nDCG@k for Ranking Eval

**Scope.** This doc is the single source of truth for how `ndcgAtK`, `precisionAtK`, and `mustIncludeRecall` are computed in the ranking eval pipeline. The Phase 2 coder should implement directly from this doc — no further research required.

**Context.** Graded relevance is fixed by `docs/spec/ranking-eval-pipeline/design.md` §A2:

| Tier   | Relevance (`rel`) |
|--------|-------------------|
| `must` | 3                 |
| `nice` | 1                 |
| `drop` | 0                 |

Default `k = 10` (newsletter target size). The ranker output is an ordered list (best-first). Ground truth is a *set* of `{rawItemId, tier}` labels — not a ranking.

We are **NOT** taking an npm dependency for this. The math is ~30 lines of TS, easy to read, easy to unit-test, and any TS package on npm is unmaintained / unaudited. Hand-roll it inside `@newsletter/pipeline/src/eval/scoring.ts`.

---

## 1. Formula

### 1.1 DCG@k

We use the **sklearn / Järvelin & Kekäläinen (2002) original** form:

```
DCG@k = Σ_{i=1..k}  rel_i / log2(i + 1)
```

where `rel_i` is the relevance of the item at rank position `i` (1-indexed) in the ranker's output, and `i + 1` ensures rank 1 → `log2(2) = 1` (no discount on the top result).

**Why the linear form, not the `(2^rel - 1)` form?**

1. **sklearn uses the linear form.** Confirmed by reading `scikit-learn/sklearn/metrics/_ranking.py` (`_dcg_sample_scores`, main branch): the discount is computed as `1 / (np.log(np.arange(n) + 2) / np.log(2))` and the gain is `y_true` itself — no exponentiation. sklearn is the canonical reference any eng will reach for when sanity-checking our numbers.
2. **Our relevance scale is tiny (0/1/3).** With rel ∈ {0, 1, 3}, the two forms differ as follows for a single ideal-rank-1 item: linear DCG contribution = 3.0; exponential DCG contribution = `2^3 - 1 = 7.0`. After normalization by IDCG the *ratio* is similar, but absolute DCG values diverge sharply. Since we publish only nDCG (a [0, 1] ratio), the numerical difference is small; the readability win of matching sklearn is large.
3. **Citations.**
   - Järvelin & Kekäläinen, *Cumulated Gain-Based Evaluation of IR Techniques* (ACM TOIS 2002) — original formulation, linear gain. https://dl.acm.org/doi/10.1145/582415.582418
   - sklearn implementation: https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/metrics/_ranking.py — see `_dcg_sample_scores`.
   - The exponential form `(2^rel - 1) / log2(i + 1)` is from Burges et al. (2005), used by LambdaRank/XGBoost/Kaggle. We are *not* using it.

**Decision: linear form, log base 2.**

### 1.2 IDCG@k

```
IDCG@k = DCG@k computed over the ground-truth labels sorted by rel desc
       = Σ_{i=1..min(k, |GT|)}  rel*_i / log2(i + 1)
```

where `rel*_i` is the *i*-th largest relevance among ground-truth labels.

### 1.3 nDCG@k

```
nDCG@k = DCG@k / IDCG@k          if IDCG@k > 0
nDCG@k = 0                        if IDCG@k == 0
```

Returns a value in `[0, 1]`. sklearn returns `0` for the all-irrelevant case (`_ndcg_sample_scores`: `gain[all_irrelevant] = 0`); we match that.

---

## 2. IDCG construction — which items count?

This is the load-bearing decision. Two viable strategies:

**(a) Ideal over the *labeled* set (ground truth only).** Sort the ground-truth labels by tier desc; take the top `k` relevances; compute DCG over them.

**(b) Ideal over the *candidate pool* (ranker output ∪ ground truth).** Sort the union by relevance desc; ranker-returned-but-unlabeled items contribute rel = 0; compute DCG over the top `k`.

### Decision: **(a) Ideal over the labeled set.**

**Justification.**

The eval question we are answering is: *"Given a fixed labeling budget, how well does the ranker order the items we know about?"* The ranker is being judged against the human-graded ground truth, not against its own retrieval. If the ranker pulls in some unlabeled item, treating that as a missing label inflates the denominator (lowering nDCG) and punishes the ranker for *discovering* items the labeler didn't see — which is the opposite of what we want.

Strategy (a) also matches the conceptual definition every IR textbook uses: IDCG is the DCG of the *perfect ordering of the items being evaluated*, and the items being evaluated are the ones with labels.

**Consequence.** If the ranker returns an item not in ground truth, it contributes `rel = 0` to the *numerator* (DCG) but does not affect the *denominator* (IDCG). This penalizes the ranker for spending a slot on an unknown item, which is the intended signal.

**Consequence (recall).** If the ground truth contains items the ranker did not return, those items still appear in IDCG (they're in the ideal ordering). This means the ranker's nDCG drops if it misses a high-tier item — also the intended signal. The complementary `mustIncludeRecall` metric quantifies this directly.

---

## 3. Edge cases

| Case                                                     | Behavior                                                                                                          |
|----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `IDCG@k == 0` (all GT labels are `drop`, or GT is empty) | Return `nDCG = 0`. (sklearn convention; alternative `1.0` is defensible but ambiguous — "perfect by vacuity"). |
| Ranker returns fewer than `k` items                      | Pad implicitly with rel = 0. Don't extrapolate; the missing slots simply don't add to DCG.                        |
| Ranker returns an item not in ground truth               | Treat as rel = 0 (drop). Does not affect IDCG.                                                                    |
| Ground truth has fewer than `k` labeled items            | IDCG sum runs only over `min(k, |GT|)` items. Perfectly well-defined.                                             |
| All GT labels are `drop`                                 | IDCG = 0 → nDCG = 0.                                                                                              |
| Duplicate `rawItemId` in ranker output                   | Caller's bug. Spec assumes uniqueness; do **not** silently dedupe. Add a defensive `Set` size check and throw.    |
| `k <= 0`                                                 | Throw. Out of contract.                                                                                           |
| Ranker returns more than `k` items                       | Only the first `k` are scored. The tail is ignored.                                                               |

---

## 4. Worked example (becomes unit-test fixture VS-0.2)

**Setup.** 5 items in ranker order: `A, B, C, D, E`. Ground truth = `{A: must, B: nice, C: drop, D: must, E: drop, F: nice}` — note `F` was labeled but the ranker did not return it.

Relevance per ranker position (1-indexed):

| Rank `i` | Item | Tier | `rel_i` | `1 / log2(i+1)`            | Contribution         |
|----------|------|------|---------|-----------------------------|----------------------|
| 1        | A    | must | 3       | `1 / log2(2) = 1.0000`      | 3.0000               |
| 2        | B    | nice | 1       | `1 / log2(3) ≈ 0.6309`      | 0.6309               |
| 3        | C    | drop | 0       | `1 / log2(4) = 0.5000`      | 0.0000               |
| 4        | D    | must | 3       | `1 / log2(5) ≈ 0.4307`      | 1.2920               |
| 5        | E    | drop | 0       | `1 / log2(6) ≈ 0.3869`      | 0.0000               |

**DCG@5** = 3.0000 + 0.6309 + 0.0000 + 1.2920 + 0.0000 = **4.9229**

**Ideal ordering of GT** (sort by rel desc): `must=3, must=3, nice=1, nice=1, drop=0, drop=0` → relevances `[3, 3, 1, 1, 0, 0]`. Take top 5 → `[3, 3, 1, 1, 0]`.

| Rank `i` | `rel*_i` | discount  | Contribution |
|----------|----------|-----------|--------------|
| 1        | 3        | 1.0000    | 3.0000       |
| 2        | 3        | 0.6309    | 1.8928       |
| 3        | 1        | 0.5000    | 0.5000       |
| 4        | 1        | 0.4307    | 0.4307       |
| 5        | 0        | 0.3869    | 0.0000       |

**IDCG@5** = 3.0000 + 1.8928 + 0.5000 + 0.4307 + 0.0000 = **5.8235**

**nDCG@5** = 4.9229 / 5.8235 ≈ **0.8454**

Expected unit-test assertion: `ndcgAtK(ranked, gt, 5)` returns `0.8454` ± 1e-4.

Independent sanity check (Python):
```python
from sklearn.metrics import ndcg_score
import numpy as np
# Score the ranker as: A>B>C>D>E>F (F last because ranker did not return it; we extend with score 0)
y_true  = np.array([[3, 1, 0, 3, 0, 1]])  # A B C D E F
y_score = np.array([[6, 5, 4, 3, 2, 0]])  # ranker order: A B C D E, F unseen
print(ndcg_score(y_true, y_score, k=5))   # -> 0.8454...
```

---

## 5. Reference implementations

### 5.1 sklearn.metrics.ndcg_score (Python — gold standard)

- File: https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/metrics/_ranking.py
- Key functions: `_dcg_sample_scores` (line ~1655), `_ndcg_sample_scores` (line ~1898), `ndcg_score` (line ~1959).
- Discount formula: `1 / (np.log(np.arange(n) + 2) / np.log(log_base))` — i.e. `1 / log2(i + 2)` with `i` 0-indexed, equivalent to `1 / log2(rank + 1)` with `rank` 1-indexed.
- Gain: `y_true` directly, no exponentiation.
- All-irrelevant handling: `gain[all_irrelevant] = 0` (returns 0, emits a UserWarning at the public API).
- Tie handling: averages gains within tie groups by default (`ignore_ties=False`). We won't need this — every ranker output is a strict order.

### 5.2 TypeScript / JS implementations on npm

Searched npm registry and GitHub for usable references:

- `@hpcc-js/dgrid`, `ranking-metrics`, `ml-metrics` — none implement nDCG; `ml-metrics` is classification-only.
- A handful of unmaintained, single-author packages (e.g. `ndcg`, `dcg-score`) exist with <1k weekly downloads, no types, last commit >3 years. **Do not depend on these.**
- Recommendation crystallized: **hand-roll**. The implementation is 20–30 lines, has zero non-deterministic behavior, and the unit tests in §4 / §8 prove correctness.

### 5.3 Useful explainers (for reviewers, not dependencies)

- Wikipedia: https://en.wikipedia.org/wiki/Discounted_cumulative_gain
- Evidently AI nDCG explainer: https://www.evidentlyai.com/ranking-metrics/ndcg-metric
- Aparna Dhinakaran, "Demystifying NDCG" (TDS): https://medium.com/data-science/demystifying-ndcg-bee3be58cfe0

---

## 6. Implementation skeleton (TypeScript)

The coder should add these to `packages/pipeline/src/eval/scoring.ts`. JSDoc is binding — do not relax the contracts.

```ts
export type Tier = 'must' | 'nice' | 'drop';

/** Graded-relevance mapping from §A2 of the design. Frozen by spec. */
export const TIER_RELEVANCE: Readonly<Record<Tier, number>> = Object.freeze({
  must: 3,
  nice: 1,
  drop: 0,
});

export interface RankedItem {
  readonly rawItemId: number;
}

export interface GroundTruthLabel {
  readonly rawItemId: number;
  readonly tier: Tier;
}

/**
 * Normalized Discounted Cumulative Gain at rank k.
 *
 * Formula (sklearn / Järvelin–Kekäläinen 2002, linear gain):
 *   DCG@k  = Σ_{i=1..k}     rel_i  / log2(i + 1)
 *   IDCG@k = Σ_{i=1..|GT|≤k} rel*_i / log2(i + 1)   (rel* = GT relevances sorted desc)
 *   nDCG@k = DCG@k / IDCG@k       (0 if IDCG@k == 0)
 *
 * IDCG is computed over the GROUND-TRUTH LABEL SET ONLY — items the ranker
 * returned but the labeler did not grade contribute rel = 0 to DCG and do
 * NOT enter IDCG. (See library-probe.md §2.)
 *
 * @param rankedItems Ranker output in rank order (best first). May be longer than k;
 *                    only the first k entries are scored. Must not contain duplicate
 *                    rawItemIds — throws if it does.
 * @param groundTruth Set of labeled items. Order is irrelevant. May contain items
 *                    not in `rankedItems` (recall problem — those reduce nDCG via IDCG).
 *                    May contain fewer than k items.
 * @param k           Cutoff rank, must be >= 1. Throws on k <= 0.
 * @returns           nDCG@k in [0, 1]. Returns 0 when IDCG@k == 0 (no graded-relevant
 *                    items in ground truth, or all labels are 'drop').
 *
 * @example
 *   ndcgAtK(
 *     [{rawItemId:1},{rawItemId:2},{rawItemId:3},{rawItemId:4},{rawItemId:5}],
 *     [{rawItemId:1,tier:'must'},{rawItemId:2,tier:'nice'},{rawItemId:3,tier:'drop'},
 *      {rawItemId:4,tier:'must'},{rawItemId:5,tier:'drop'},{rawItemId:6,tier:'nice'}],
 *     5,
 *   ) // ≈ 0.8454
 */
export function ndcgAtK(
  rankedItems: ReadonlyArray<RankedItem>,
  groundTruth: ReadonlyArray<GroundTruthLabel>,
  k: number,
): number;

/**
 * Precision at rank k. Fraction of the top-k ranker output that has a
 * non-zero graded relevance in ground truth (tier ∈ {must, nice}).
 *
 *   P@k = |{i ∈ top-k : rel_i > 0}| / k
 *
 * Items returned by the ranker but absent from ground truth are treated as
 * rel = 0 (i.e. they do NOT count toward precision). The denominator is
 * always k, never the size of the ranker output — a ranker that returns
 * fewer than k items takes the implicit hit.
 *
 * @param rankedItems Ranker output (best first). Duplicates throw.
 * @param groundTruth Labeled items.
 * @param k           Cutoff rank, must be >= 1. Throws on k <= 0.
 * @returns           Precision in [0, 1].
 */
export function precisionAtK(
  rankedItems: ReadonlyArray<RankedItem>,
  groundTruth: ReadonlyArray<GroundTruthLabel>,
  k: number,
): number;

/**
 * Must-include recall. Fraction of ground-truth `must` items that appear
 * anywhere in the ranker's top-k output.
 *
 *   recall_must@k = |{i ∈ top-k : tier_i == 'must'}| / |{x ∈ GT : tier_x == 'must'}|
 *
 * Captures the "did the ranker surface every story the editor flagged as
 * non-negotiable" signal — complements nDCG, which can mask a missed
 * must-include if enough nice-includes are surfaced.
 *
 * @param rankedItems Ranker output (best first). Duplicates throw.
 * @param groundTruth Labeled items.
 * @param k           Cutoff rank, must be >= 1. Throws on k <= 0.
 * @returns           Recall in [0, 1]. Returns 1.0 when ground truth contains
 *                    zero `must` items (vacuously perfect — there is nothing
 *                    to miss).
 */
export function mustIncludeRecall(
  rankedItems: ReadonlyArray<RankedItem>,
  groundTruth: ReadonlyArray<GroundTruthLabel>,
  k: number,
): number;
```

**Implementation hints for the coder (non-binding):**

- Build `Map<rawItemId, rel>` from `groundTruth` once.
- Iterate the first `min(k, rankedItems.length)` ranker entries, look up rel (default 0), accumulate `rel / Math.log2(i + 1)` (with `i` starting at 1).
- For IDCG: extract all rel values from the GT map, sort desc, take first `min(k, gt.size)`, accumulate with the same discount.
- For duplicate detection: track a `Set<number>` while iterating; throw on second occurrence.
- Use `Math.log2`, not `Math.log(x) / Math.log(2)`. (`Math.log2` is ES2015, fine for our Node target.)

---

## 7. Verdict

<!-- LP:VERDICT:PASS -->

No external dependencies. Pure-math implementation against well-defined spec, hand-rolled in `@newsletter/pipeline/src/eval/scoring.ts`. The unit tests in §8 + the worked example in §4 are sufficient verification.

---

## 8. Verification stubs (for spec-generation → VS-0)

See `verification/verification-stubs.md` for the canonical format. Summary list:

| ID      | Name                                                | Expected                  |
|---------|-----------------------------------------------------|---------------------------|
| VS-0.1  | Perfect ranking → nDCG = 1                          | 1.0                       |
| VS-0.2  | Worked example from §4 (mixed tiers + missing GT)   | ≈ 0.8454                  |
| VS-0.3  | All-drop ground truth → nDCG = 0                    | 0.0                       |
| VS-0.4  | Empty ground truth → nDCG = 0                       | 0.0                       |
| VS-0.5  | Ranker misses a `must` → must-recall < 1            | recall < 1.0              |
| VS-0.6  | Ranker returns < k items → P@k denominator stays k  | P@k = hits / k            |
| VS-0.7  | Duplicate rawItemId in ranker → throws              | throws                    |
