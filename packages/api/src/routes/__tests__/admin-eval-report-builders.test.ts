import { describe, expect, it } from "vitest";
import type {
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import type { RankedItemRef } from "@newsletter/shared";
import { buildActualRanking, buildExpectedRanking } from "../../services/eval-report.js";

function poolItem(
  rawItemId: number,
  title: string,
  url: string,
): Fixture["pool"][number] {
  return {
    rawItemId,
    title,
    url,
    sourceType: "hn",
    publishedAt: "2026-05-20T12:00:00.000Z",
    content: null,
    enrichedLink: null,
    enrichmentStatus: "ok",
    comments: [],
    engagement: null,
  };
}

function makeFixture(): Fixture {
  return {
    fixtureId: "manual-test-1",
    source: "manual",
    date: null,
    runId: null,
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-21T00:00:00.000Z",
    pool: [
      poolItem(101, "Alpha launch", "https://example.com/a"),
      poolItem(102, "Beta release", "https://example.com/b"),
      poolItem(103, "Gamma update", "https://example.com/c"),
      poolItem(104, "Delta drop", "https://example.com/d"),
    ],
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

describe("buildActualRanking", () => {
  it("joins ranked items with the fixture pool to recover url/title and preserves recap fields", () => {
    const fixture = makeFixture();
    const ranked: RankedItemRef[] = [
      {
        rawItemId: 102,
        score: 0.91,
        rationale: "novel",
        title: "Beta release · refined",
        summary: "what happened",
        bullets: ["b1", "b2"],
        bottomLine: "bl",
      },
      {
        rawItemId: 101,
        score: 0.82,
        rationale: "useful",
      },
    ];
    const result = buildActualRanking(ranked, fixture);
    expect(result).toEqual([
      {
        rawItemId: 102,
        url: "https://example.com/b",
        title: "Beta release · refined",
        score: 0.91,
        rationale: "novel",
        summary: "what happened",
        bullets: ["b1", "b2"],
        bottomLine: "bl",
      },
      {
        rawItemId: 101,
        url: "https://example.com/a",
        title: "Alpha launch",
        score: 0.82,
        rationale: "useful",
        summary: "",
        bullets: [],
        bottomLine: "",
      },
    ]);
  });

  it("returns empty array on empty input", () => {
    const fixture = makeFixture();
    expect(buildActualRanking([], fixture)).toEqual([]);
  });

  it("emits empty url/title when an item is not in the fixture pool (defensive)", () => {
    const fixture = makeFixture();
    const ranked: RankedItemRef[] = [
      { rawItemId: 9999, score: 0.5, rationale: "?" },
    ];
    const result = buildActualRanking(ranked, fixture);
    expect(result[0].url).toBe("");
    expect(result[0].title).toBe("");
  });
});

describe("buildExpectedRanking", () => {
  it("sorts items by tier priority (must < nice < drop) and ignores ungraded pool items", () => {
    const fixture = makeFixture();
    const gt: GroundTruth = {
      fixtureId: fixture.fixtureId,
      gradedBy: ["aman"],
      gradedAt: "2026-05-21T11:00:00.000Z",
      labels: [
        { rawItemId: 101, tier: "nice" },
        { rawItemId: 102, tier: "must" },
        { rawItemId: 103, tier: "drop" },
        // 104 is intentionally ungraded — must be excluded.
      ],
    };
    const result = buildExpectedRanking(gt, fixture);
    expect(result).toEqual([
      {
        rawItemId: 102,
        url: "https://example.com/b",
        title: "Beta release",
        tier: "must",
        rank: 1,
      },
      {
        rawItemId: 101,
        url: "https://example.com/a",
        title: "Alpha launch",
        tier: "nice",
        rank: 2,
      },
      {
        rawItemId: 103,
        url: "https://example.com/c",
        title: "Gamma update",
        tier: "drop",
        rank: 3,
      },
    ]);
  });

  it("returns empty array when no labels overlap with the pool", () => {
    const fixture = makeFixture();
    const gt: GroundTruth = {
      fixtureId: fixture.fixtureId,
      gradedBy: ["aman"],
      gradedAt: "2026-05-21T11:00:00.000Z",
      labels: [{ rawItemId: 9999, tier: "must" }],
    };
    expect(buildExpectedRanking(gt, fixture)).toEqual([]);
  });

  it("preserves pool order within the same tier (stable sort)", () => {
    const fixture = makeFixture();
    const gt: GroundTruth = {
      fixtureId: fixture.fixtureId,
      gradedBy: ["aman"],
      gradedAt: "2026-05-21T11:00:00.000Z",
      labels: [
        { rawItemId: 101, tier: "must" },
        { rawItemId: 102, tier: "must" },
        { rawItemId: 103, tier: "must" },
      ],
    };
    const result = buildExpectedRanking(gt, fixture);
    expect(result.map((r) => r.rawItemId)).toEqual([101, 102, 103]);
  });
});
