import { TIER_RELEVANCE } from "@newsletter/shared/constants/eval-ranking";
import type {
  Fixture,
  GroundTruth,
  GroundTruthLabel,
  PerItemDiffRow,
  RankedItem,
  SourcingReportRow,
  Tier,
} from "@newsletter/shared/types/eval-ranking";

function assertK(k: number): void {
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`k must be a positive integer, got ${k}`);
  }
}

function uniqueRankerIds(rankedItems: readonly RankedItem[]): void {
  const seen = new Set<number>();
  for (const item of rankedItems) {
    if (seen.has(item.rawItemId)) {
      throw new Error(`Duplicate rawItemId in rankedItems: ${item.rawItemId}`);
    }
    seen.add(item.rawItemId);
  }
}

/**
 * Normalized Discounted Cumulative Gain at rank k.
 *
 * Formula (sklearn / Järvelin–Kekäläinen 2002, linear gain):
 *   DCG@k  = Σ_{i=1..k}      rel_i  / log2(i + 1)
 *   IDCG@k = Σ_{i=1..|GT|≤k} rel*_i / log2(i + 1)
 *   nDCG@k = DCG@k / IDCG@k       (0 if IDCG@k === 0)
 *
 * IDCG is computed over the GROUND-TRUTH LABEL SET ONLY — items the ranker
 * returned but the labeler did not grade contribute rel = 0 to DCG and do
 * NOT enter IDCG. See `.harness/features/ranking-eval-pipeline/library-probe.md` §2.
 *
 * @throws if `k <= 0` or `rankedItems` contains a duplicate `rawItemId`.
 */
export function ndcgAtK(
  rankedItems: readonly RankedItem[],
  groundTruth: readonly GroundTruthLabel[],
  k: number,
): number {
  assertK(k);
  uniqueRankerIds(rankedItems);

  const relById = new Map<number, number>();
  for (const label of groundTruth) {
    relById.set(label.rawItemId, TIER_RELEVANCE[label.tier]);
  }

  const cutoff = Math.min(k, rankedItems.length);
  let dcg = 0;
  for (let i = 0; i < cutoff; i += 1) {
    const item = rankedItems[i];
    const rel = relById.get(item.rawItemId) ?? 0;
    if (rel === 0) continue;
    dcg += rel / Math.log2(i + 2);
  }

  const idealRels = Array.from(relById.values()).sort((a, b) => b - a);
  const idealCutoff = Math.min(k, idealRels.length);
  let idcg = 0;
  for (let i = 0; i < idealCutoff; i += 1) {
    const rel = idealRels[i];
    if (rel === 0) continue;
    idcg += rel / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Precision at rank k = `|{i ∈ top-k : rel_i > 0}| / k`.
 *
 * Denominator is always `k`, never `rankedItems.length` — a ranker that
 * returns fewer than `k` items takes the implicit hit.
 *
 * @throws if `k <= 0` or `rankedItems` contains a duplicate.
 */
export function precisionAtK(
  rankedItems: readonly RankedItem[],
  groundTruth: readonly GroundTruthLabel[],
  k: number,
): number {
  assertK(k);
  uniqueRankerIds(rankedItems);

  const tierById = new Map<number, Tier>();
  for (const label of groundTruth) {
    tierById.set(label.rawItemId, label.tier);
  }

  const cutoff = Math.min(k, rankedItems.length);
  let hits = 0;
  for (let i = 0; i < cutoff; i += 1) {
    const item = rankedItems[i];
    const tier = tierById.get(item.rawItemId);
    if (tier === "must" || tier === "nice") hits += 1;
  }
  return hits / k;
}

/**
 * Must-include recall — fraction of ground-truth `must` items that appear
 * anywhere in the ranker's top-k output.
 *
 * Returns `1` when ground truth contains zero `must` items (vacuously
 * perfect — nothing to miss).
 *
 * @throws if `k <= 0` or `rankedItems` contains a duplicate.
 */
export function mustIncludeRecall(
  rankedItems: readonly RankedItem[],
  groundTruth: readonly GroundTruthLabel[],
  k: number,
): number {
  assertK(k);
  uniqueRankerIds(rankedItems);

  const mustIds = new Set<number>();
  for (const label of groundTruth) {
    if (label.tier === "must") mustIds.add(label.rawItemId);
  }
  if (mustIds.size === 0) return 1;

  const cutoff = Math.min(k, rankedItems.length);
  let recovered = 0;
  for (let i = 0; i < cutoff; i += 1) {
    const item = rankedItems[i];
    if (mustIds.has(item.rawItemId)) recovered += 1;
  }
  return recovered / mustIds.size;
}

/**
 * Returns `true` iff the rank-1 item is labeled `must` in ground truth.
 * Returns `false` on empty ranker output.
 */
export function rankOneIsMustInclude(
  rankedItems: readonly RankedItem[],
  groundTruth: readonly GroundTruthLabel[],
): boolean {
  if (rankedItems.length === 0) return false;
  const first = rankedItems[0];
  for (const label of groundTruth) {
    if (label.rawItemId === first.rawItemId) return label.tier === "must";
  }
  return false;
}

/**
 * Union diff of ranker top-k and ground-truth labels. Every `rawItemId`
 * appearing in either input gets one row; `rankerRank` is 1-indexed or
 * `null` (item only in ground truth); `groundTruthTier` is `null` when
 * the item is only in the ranker output.
 */
export function perItemDiff(
  rankedItems: readonly RankedItem[],
  groundTruth: readonly GroundTruthLabel[],
): PerItemDiffRow[] {
  const rankerRankById = new Map<number, number>();
  rankedItems.forEach((item, idx) => {
    if (!rankerRankById.has(item.rawItemId)) {
      rankerRankById.set(item.rawItemId, idx + 1);
    }
  });

  const tierById = new Map<number, Tier>();
  for (const label of groundTruth) tierById.set(label.rawItemId, label.tier);

  const ids = new Set<number>([...rankerRankById.keys(), ...tierById.keys()]);
  const rows: PerItemDiffRow[] = [];
  for (const rawItemId of ids) {
    rows.push({
      rawItemId,
      rankerRank: rankerRankById.get(rawItemId) ?? null,
      groundTruthTier: tierById.get(rawItemId) ?? null,
    });
  }
  return rows;
}

/** A fixture + its ground truth, paired for `sourcingReport()`. */
export interface FixtureWithGroundTruth {
  fixture: Fixture;
  groundTruth: GroundTruth;
}

/**
 * Aggregate must/nice/drop counts across multiple fixtures, bucketed by
 * `FixtureItem.sourceType`. Sorted by `mustIncludeCount` descending.
 */
export function sourcingReport(
  graded: readonly FixtureWithGroundTruth[],
): SourcingReportRow[] {
  const buckets = new Map<
    string,
    { mustIncludeCount: number; niceCount: number; dropCount: number }
  >();

  for (const { fixture, groundTruth } of graded) {
    const sourceTypeById = new Map<number, string>();
    for (const item of fixture.pool) {
      sourceTypeById.set(item.rawItemId, item.sourceType);
    }

    for (const label of groundTruth.labels) {
      const sourceType = sourceTypeById.get(label.rawItemId);
      if (!sourceType) continue;
      const bucket = buckets.get(sourceType) ?? {
        mustIncludeCount: 0,
        niceCount: 0,
        dropCount: 0,
      };
      if (label.tier === "must") bucket.mustIncludeCount += 1;
      else if (label.tier === "nice") bucket.niceCount += 1;
      else bucket.dropCount += 1;
      buckets.set(sourceType, bucket);
    }
  }

  return Array.from(buckets.entries())
    .map(([sourceType, counts]) => ({ sourceType, ...counts }))
    .sort((a, b) => b.mustIncludeCount - a.mustIncludeCount);
}
