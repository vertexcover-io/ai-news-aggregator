import type {
  ActualRankingItem,
  CalendarRankingItem,
  CalendarRunDetail,
  ExpectedRankingItem,
  Fixture,
  FixtureItem,
  GroundTruth,
  Tier,
} from "@newsletter/shared/types/eval-ranking";
import type { RunEvalOutput } from "@newsletter/pipeline/eval";

const PROMPT_SNAPSHOT_MAX_LEN = 65536;
const TRUNCATION_SUFFIX = "…";

export function truncateSnapshot(prompt: string): string {
  if (prompt.length <= PROMPT_SNAPSHOT_MAX_LEN) return prompt;
  return prompt.slice(0, PROMPT_SNAPSHOT_MAX_LEN - TRUNCATION_SUFFIX.length) +
    TRUNCATION_SUFFIX;
}

const TIER_ORDER: Record<Tier, number> = { must: 0, nice: 1, drop: 2 };

/**
 * Join the ranker's per-item output with fixture-pool metadata to produce the
 * comparison-report payload. Pure derivation — no I/O. Exported for tests.
 */
export function buildActualRanking(
  rankedItems: RunEvalOutput["rankedItems"],
  fixture: Fixture,
): ActualRankingItem[] {
  const itemById = new Map(fixture.pool.map((p) => [p.rawItemId, p]));
  return rankedItems.map((r) => {
    const pool = itemById.get(r.rawItemId);
    return {
      rawItemId: r.rawItemId,
      url: pool?.url ?? "",
      title: r.title ?? pool?.title ?? "",
      score: r.score,
      rationale: r.rationale,
      summary: r.summary ?? "",
      bullets: r.bullets ?? [],
      bottomLine: r.bottomLine ?? "",
    };
  });
}

/**
 * Snapshot the fixture's graded ground truth at run time so later regrades do
 * not retroactively shift a historical report. Items in the fixture pool that
 * have no GT label are excluded — they were not graded, so they do not belong
 * in the expected order. Drop-tier items still appear, sorted last, so the
 * operator can see "the ranker correctly excluded these".
 */
export function buildExpectedRanking(
  groundTruth: GroundTruth,
  fixture: Fixture,
): ExpectedRankingItem[] {
  const labelById = new Map(
    groundTruth.labels.map((l) => [l.rawItemId, l.tier]),
  );
  const labelled = fixture.pool
    .map((pool) => {
      const tier = labelById.get(pool.rawItemId);
      return tier === undefined ? null : { pool, tier };
    })
    .filter((entry): entry is { pool: Fixture["pool"][number]; tier: Tier } =>
      entry !== null,
    )
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return labelled.map((entry, idx) => ({
    rawItemId: entry.pool.rawItemId,
    url: entry.pool.url,
    title: entry.pool.title,
    tier: entry.tier,
    rank: idx + 1,
  }));
}

export function buildCalendarRanking(
  rankedItems: readonly {
    rawItemId: number;
    score: number;
    rationale: string;
    title?: string;
    summary?: string;
    bullets?: string[];
    bottomLine?: string;
  }[],
  sourcePool: readonly FixtureItem[],
): CalendarRankingItem[] {
  const sourceById = new Map(sourcePool.map((item) => [item.rawItemId, item]));
  return rankedItems.map((item, index) => {
    const source = sourceById.get(item.rawItemId);
    return {
      rank: index + 1,
      rawItemId: item.rawItemId,
      title: item.title ?? source?.title ?? `#${String(item.rawItemId)}`,
      url: source?.url ?? "",
      sourceType: source?.sourceType ?? "",
      score: item.score,
      rationale: item.rationale,
      summary: item.summary ?? "",
      bullets: item.bullets ?? [],
      bottomLine: item.bottomLine ?? "",
    };
  });
}

export function buildCalendarRunFixture(
  detail: CalendarRunDetail,
  date: string,
  model: string,
): Fixture {
  return {
    fixtureId: `calendar-${detail.runId}`,
    source: "calendar",
    date,
    runId: detail.runId,
    model,
    exportedAt: new Date().toISOString(),
    // detail.sourcePool is already deduped by getCompletedRunDetail (REQ-006),
    // so dedupClusters is correctly empty — fixtureToCandidates won't re-add dupes.
    pool: detail.sourcePool,
    dedupClusters: [],
    originalRankerOutput: detail.previousRanking.map((item) => ({
      rawItemId: item.rawItemId,
      score: item.score,
      rationale: item.rationale,
    })),
  };
}
