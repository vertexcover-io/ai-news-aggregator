# Verification Stubs — Scoring Metrics (nDCG, P@k, must-include recall)

Source: `docs/spec/ranking-eval-pipeline/library-probe.md` §8.

Format: one scenario per heading. `Given / When / Then`. Spec-generation should fold these into the SPEC as VS-0 scenarios verbatim.

---

## VS-0.1 Perfect ranking yields nDCG = 1

**Given** a ranker output `[A, B, C, D, E]` and ground truth
`{A: must, B: must, C: nice, D: nice, E: drop}` (already in ideal order),
**When** `ndcgAtK(ranked, gt, 5)` is called,
**Then** the result equals `1.0` exactly (within `1e-9` tolerance).

---

## VS-0.2 Worked-example fixture (mixed tiers, ranker misses one labeled item)

**Given** ranker output `[A, B, C, D, E]` and ground truth
`{A: must, B: nice, C: drop, D: must, E: drop, F: nice}` (F labeled but not returned),
**When** `ndcgAtK(ranked, gt, 5)` is called,
**Then** the result is `0.8454` ± `1e-4`.

(Worked by hand in library-probe.md §4; verified against `sklearn.metrics.ndcg_score`.)

---

## VS-0.3 All-`drop` ground truth → nDCG = 0

**Given** ranker output `[A, B, C]` and ground truth `{A: drop, B: drop, C: drop}`,
**When** `ndcgAtK(ranked, gt, 3)` is called,
**Then** the result is exactly `0.0` (IDCG = 0 → return 0, not NaN, not 1.0).

---

## VS-0.4 Empty ground truth → nDCG = 0

**Given** ranker output `[A, B, C]` and ground truth `[]`,
**When** `ndcgAtK(ranked, gt, 3)` is called,
**Then** the result is exactly `0.0`.

---

## VS-0.5 Ranker misses a `must` item → must-include recall < 1

**Given** ground truth containing three `must` items `{X, Y, Z}` plus filler,
and ranker output of length 10 that includes `X` and `Y` but **not** `Z`,
**When** `mustIncludeRecall(ranked, gt, 10)` is called,
**Then** the result is `2/3` (≈ `0.6667`), not `1.0`.

---

## VS-0.6 Ranker returns fewer than k items → P@k denominator is still k

**Given** ranker output of length 5 (`[A, B, C, D, E]`) where 3 of those items
are graded `must` or `nice` in ground truth, and `k = 10`,
**When** `precisionAtK(ranked, gt, 10)` is called,
**Then** the result is `3 / 10 = 0.3` — the missing 5 slots count as misses,
the denominator is **not** clipped to `ranked.length`.

---

## VS-0.7 Duplicate rawItemId in ranker output → throws

**Given** ranker output `[{rawItemId: 1}, {rawItemId: 2}, {rawItemId: 1}]`
(item 1 appears twice),
**When** any of `ndcgAtK`, `precisionAtK`, `mustIncludeRecall` is called with
this input,
**Then** the function throws an `Error` whose message names the duplicate
`rawItemId`. (Defensive boundary check; do not silently dedupe.)
