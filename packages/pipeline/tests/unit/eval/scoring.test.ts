import { describe, expect, it } from "vitest";

import type {
  Fixture,
  FixtureItem,
  GroundTruth,
  GroundTruthLabel,
  RankedItem,
} from "@newsletter/shared/types/eval-ranking";

import {
  mustIncludeRecall,
  ndcgAtK,
  perItemDiff,
  precisionAtK,
  rankOneIsMustInclude,
  sourcingReport,
} from "@pipeline/eval/scoring";

const r = (id: number): RankedItem => ({ rawItemId: id });
const label = (
  rawItemId: number,
  tier: GroundTruthLabel["tier"],
): GroundTruthLabel => ({ rawItemId, tier });

describe("ndcgAtK", () => {
  it("VS-0.1 perfect ranking yields nDCG = 1", () => {
    const ranked = [r(1), r(2), r(3), r(4), r(5)];
    const gt = [
      label(1, "must"),
      label(2, "must"),
      label(3, "nice"),
      label(4, "nice"),
      label(5, "drop"),
    ];
    expect(ndcgAtK(ranked, gt, 5)).toBeCloseTo(1.0, 9);
  });

  it("VS-0.2 worked-example fixture matches library-probe.md §4 (≈ 0.8454)", () => {
    const ranked = [r(1), r(2), r(3), r(4), r(5)];
    const gt = [
      label(1, "must"),
      label(2, "nice"),
      label(3, "drop"),
      label(4, "must"),
      label(5, "drop"),
      label(6, "nice"),
    ];
    expect(ndcgAtK(ranked, gt, 5)).toBeCloseTo(0.8454, 4);
  });

  it("VS-0.3 all-drop ground truth → nDCG = 0", () => {
    const ranked = [r(1), r(2), r(3)];
    const gt = [label(1, "drop"), label(2, "drop"), label(3, "drop")];
    expect(ndcgAtK(ranked, gt, 3)).toBe(0);
  });

  it("VS-0.4 empty ground truth → nDCG = 0", () => {
    const ranked = [r(1), r(2), r(3)];
    expect(ndcgAtK(ranked, [], 3)).toBe(0);
  });

  it("returns 0 when k <= 0 is rejected (throws)", () => {
    expect(() => ndcgAtK([r(1)], [label(1, "must")], 0)).toThrow();
    expect(() => ndcgAtK([r(1)], [label(1, "must")], -1)).toThrow();
  });
});

describe("precisionAtK", () => {
  it("VS-0.6 denominator stays k even when ranker returns fewer than k items", () => {
    const ranked = [r(1), r(2), r(3), r(4), r(5)];
    const gt = [
      label(1, "must"),
      label(2, "nice"),
      label(3, "must"),
      label(4, "drop"),
      label(5, "drop"),
    ];
    expect(precisionAtK(ranked, gt, 10)).toBeCloseTo(3 / 10, 9);
  });

  it("counts must + nice as hits, drop and unknown as misses", () => {
    const ranked = [r(1), r(2), r(3), r(4)];
    const gt = [label(1, "must"), label(2, "nice"), label(3, "drop")];
    // hits: 1, 2; miss: 3 (drop) and 4 (unknown). k = 4.
    expect(precisionAtK(ranked, gt, 4)).toBeCloseTo(2 / 4, 9);
  });
});

describe("mustIncludeRecall", () => {
  it("VS-0.5 ranker misses a must → recall < 1", () => {
    const ranked = [
      r(101),
      r(102),
      r(1),
      r(2),
      r(50),
      r(51),
      r(52),
      r(53),
      r(54),
      r(55),
    ];
    // must items: 1, 2, 3 — ranker recovers 1 and 2, misses 3.
    const gt = [
      label(1, "must"),
      label(2, "must"),
      label(3, "must"),
      label(101, "nice"),
      label(102, "nice"),
    ];
    expect(mustIncludeRecall(ranked, gt, 10)).toBeCloseTo(2 / 3, 9);
  });

  it("returns 1 when ground truth has zero must items (vacuous)", () => {
    const ranked = [r(1), r(2)];
    const gt = [label(1, "nice"), label(2, "drop")];
    expect(mustIncludeRecall(ranked, gt, 10)).toBe(1);
  });

  it("returns 0 when ranker is empty and some must exist", () => {
    expect(mustIncludeRecall([], [label(1, "must")], 10)).toBe(0);
  });
});

describe("duplicate detection (VS-0.7)", () => {
  it("ndcgAtK throws with the duplicate id in the message", () => {
    const ranked = [r(1), r(2), r(1)];
    expect(() => ndcgAtK(ranked, [label(1, "must")], 3)).toThrow(/1/);
  });

  it("precisionAtK throws on duplicates", () => {
    expect(() => precisionAtK([r(7), r(7)], [], 5)).toThrow(/7/);
  });

  it("mustIncludeRecall throws on duplicates", () => {
    expect(() => mustIncludeRecall([r(9), r(9)], [], 5)).toThrow(/9/);
  });
});

describe("rankOneIsMustInclude", () => {
  it("true when rank-1 item is labeled must", () => {
    expect(rankOneIsMustInclude([r(1), r(2)], [label(1, "must")])).toBe(true);
  });

  it("false when rank-1 item is labeled nice", () => {
    expect(rankOneIsMustInclude([r(1)], [label(1, "nice")])).toBe(false);
  });

  it("false when rank-1 item is unlabeled", () => {
    expect(rankOneIsMustInclude([r(99)], [label(1, "must")])).toBe(false);
  });

  it("false on empty ranker output", () => {
    expect(rankOneIsMustInclude([], [label(1, "must")])).toBe(false);
  });
});

describe("perItemDiff", () => {
  it("covers items in ranker only, in GT only, and in both", () => {
    const ranked = [r(1), r(2)]; // 1 also in GT, 2 only in ranker
    const gt = [label(1, "must"), label(3, "nice")]; // 3 only in GT
    const rows = perItemDiff(ranked, gt);
    const byId = new Map(rows.map((row) => [row.rawItemId, row]));
    expect(byId.size).toBe(3);
    expect(byId.get(1)).toEqual({
      rawItemId: 1,
      rankerRank: 1,
      groundTruthTier: "must",
    });
    expect(byId.get(2)).toEqual({
      rawItemId: 2,
      rankerRank: 2,
      groundTruthTier: null,
    });
    expect(byId.get(3)).toEqual({
      rawItemId: 3,
      rankerRank: null,
      groundTruthTier: "nice",
    });
  });
});

describe("sourcingReport", () => {
  const fixtureItem = (
    rawItemId: number,
    sourceType: string,
  ): FixtureItem => ({
    rawItemId,
    title: `t${rawItemId}`,
    url: `https://example.com/${rawItemId}`,
    sourceType,
    publishedAt: null,
    content: null,
    enrichedLink: null,
    enrichmentStatus: "ok",
    comments: [],
    engagement: null,
  });

  const fixture = (
    fixtureId: string,
    items: FixtureItem[],
  ): Fixture => ({
    fixtureId,
    source: "run",
    date: "2026-05-22",
    runId: "r1",
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-22T00:00:00Z",
    pool: items,
    dedupClusters: [],
    originalRankerOutput: null,
  });

  const groundTruth = (
    fixtureId: string,
    labels: GroundTruthLabel[],
  ): GroundTruth => ({
    fixtureId,
    gradedBy: ["aman"],
    gradedAt: "2026-05-22T01:00:00Z",
    labels,
  });

  it("aggregates counts by sourceType across multiple fixtures, sorted by must desc", () => {
    const f1 = fixture("f1", [
      fixtureItem(1, "hn"),
      fixtureItem(2, "hn"),
      fixtureItem(3, "reddit"),
    ]);
    const gt1 = groundTruth("f1", [
      label(1, "must"),
      label(2, "nice"),
      label(3, "drop"),
    ]);
    const f2 = fixture("f2", [
      fixtureItem(10, "hn"),
      fixtureItem(11, "twitter"),
      fixtureItem(12, "twitter"),
    ]);
    const gt2 = groundTruth("f2", [
      label(10, "must"),
      label(11, "must"),
      label(12, "nice"),
    ]);

    const report = sourcingReport([
      { fixture: f1, groundTruth: gt1 },
      { fixture: f2, groundTruth: gt2 },
    ]);

    expect(report).toEqual([
      { sourceType: "hn", mustIncludeCount: 2, niceCount: 1, dropCount: 0 },
      {
        sourceType: "twitter",
        mustIncludeCount: 1,
        niceCount: 1,
        dropCount: 0,
      },
      {
        sourceType: "reddit",
        mustIncludeCount: 0,
        niceCount: 0,
        dropCount: 1,
      },
    ]);
  });
});
