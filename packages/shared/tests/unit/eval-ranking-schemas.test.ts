import { describe, expect, it } from "vitest";

import {
  EvalResultSchema,
  EvalRunRequestSchema,
  EvalScoreSchema,
  FixtureSchema,
  GroundTruthSchema,
  PerItemDiffRowSchema,
  RankedItemSchema,
  SourcingReportRowSchema,
  TierSchema,
} from "@shared/types/eval-ranking-schemas";

describe("eval-ranking zod schemas", () => {
  it("TierSchema accepts must/nice/drop only", () => {
    expect(TierSchema.parse("must")).toBe("must");
    expect(TierSchema.parse("nice")).toBe("nice");
    expect(TierSchema.parse("drop")).toBe("drop");
    expect(() => TierSchema.parse("maybe")).toThrow();
  });

  it("RankedItemSchema requires integer rawItemId", () => {
    expect(RankedItemSchema.parse({ rawItemId: 7 })).toEqual({ rawItemId: 7 });
    expect(() => RankedItemSchema.parse({ rawItemId: 1.5 })).toThrow();
  });

  it("FixtureSchema round-trips a minimal run fixture", () => {
    const fixture = {
      fixtureId: "run-2026-05-22-abc",
      source: "run" as const,
      date: "2026-05-22",
      runId: "abc",
      model: "claude-haiku-4-5-20251001",
      exportedAt: "2026-05-22T00:00:00Z",
      pool: [
        {
          rawItemId: 1,
          title: "Hello",
          url: "https://example.com",
          sourceType: "hn",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok" as const,
          comments: [],
          engagement: { points: 10, commentCount: 2 },
        },
      ],
      dedupClusters: [{ representativeId: 1, duplicateIds: [] }],
      originalRankerOutput: null,
    };
    expect(FixtureSchema.parse(fixture)).toMatchObject({
      fixtureId: "run-2026-05-22-abc",
    });
  });

  it("GroundTruthSchema round-trips", () => {
    const gt = {
      fixtureId: "run-2026-05-22-abc",
      gradedBy: ["aman", "ritesh"],
      gradedAt: "2026-05-22T01:00:00Z",
      labels: [
        { rawItemId: 1, tier: "must" as const },
        { rawItemId: 2, tier: "drop" as const },
      ],
    };
    expect(GroundTruthSchema.parse(gt)).toEqual(gt);
  });

  it("EvalRunRequestSchema accepts scored mode with fixtureId", () => {
    const parsed = EvalRunRequestSchema.parse({
      mode: "scored",
      fixtureId: "abc",
      draftPrompt: "test prompt",
    });
    expect(parsed.mode).toBe("scored");
  });

  it("EvalScoreSchema requires the standard metrics", () => {
    const score = {
      fixtureId: "abc",
      ndcgAt10: 0.85,
      precisionAt10: 0.4,
      mustIncludeRecall: 1,
      rankOneIsMustInclude: true,
      perItemDiff: [{ rawItemId: 1, rankerRank: 1, groundTruthTier: "must" }],
      ranAt: "2026-05-22T02:00:00Z",
      promptHash: "deadbeef",
      model: "claude-haiku-4-5-20251001",
    };
    expect(EvalScoreSchema.parse(score)).toMatchObject({ ndcgAt10: 0.85 });
  });

  it("PerItemDiffRowSchema allows null rankerRank and null tier", () => {
    expect(
      PerItemDiffRowSchema.parse({
        rawItemId: 9,
        rankerRank: null,
        groundTruthTier: null,
      }),
    ).toEqual({ rawItemId: 9, rankerRank: null, groundTruthTier: null });
  });

  it("SourcingReportRowSchema rejects negative counts (non-int)", () => {
    expect(
      SourcingReportRowSchema.parse({
        sourceType: "hn",
        mustIncludeCount: 3,
        niceCount: 1,
        dropCount: 0,
      }),
    ).toMatchObject({ sourceType: "hn" });
    expect(() =>
      SourcingReportRowSchema.parse({
        sourceType: "hn",
        mustIncludeCount: 0.5,
        niceCount: 0,
        dropCount: 0,
      }),
    ).toThrow();
  });

  it("EvalResultSchema round-trips a minimal scored result", () => {
    const result = {
      mode: "scored" as const,
      perFixture: [
        {
          fixtureId: "abc",
          cost: {
            promptHash: "deadbeef",
            tokensIn: 100,
            tokensOut: 50,
            usd: 0.0012,
            cacheHit: false,
          },
        },
      ],
      totalCost: { usd: 0.0012, totalTokensIn: 100, totalTokensOut: 50 },
    };
    const parsed = EvalResultSchema.parse(result);
    expect(parsed.perFixture[0]?.fixtureId).toBe("abc");
  });
});
