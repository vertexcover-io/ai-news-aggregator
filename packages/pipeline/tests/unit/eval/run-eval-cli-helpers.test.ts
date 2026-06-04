import { describe, expect, it, vi } from "vitest";
import { formatPrettyLine, formatEvalOutput, runFixtureEval } from "../../../src/eval/run-eval-cli.js";
import type { PerFixtureResult, AggregateResult } from "../../../src/eval/run-eval-cli.js";
import type { EvalScore } from "@newsletter/shared/types/eval-ranking";

const baseScore: EvalScore = {
  fixtureId: "f1",
  ndcgAt10: 0.8,
  ndcgAt5: 0.75,
  precisionAt10: 0.7,
  mustIncludeRecall: 0.9,
  rankOneIsMustInclude: true,
  ranAt: "2025-01-01T00:00:00Z",
  perItemDiff: [],
};

describe("formatPrettyLine", () => {
  it("shows error when result has error", () => {
    const r: PerFixtureResult = { fixtureId: "f1", error: "something went wrong" };
    expect(formatPrettyLine(r)).toBe("[f1] ERROR: something went wrong");
  });

  it("shows missing ground truth message when no score and no error", () => {
    const r: PerFixtureResult = { fixtureId: "f1" };
    expect(formatPrettyLine(r)).toBe("[f1] (no score — ground truth missing)");
  });

  it("formats score correctly", () => {
    const r: PerFixtureResult = { fixtureId: "f1", score: baseScore };
    const line = formatPrettyLine(r);
    expect(line).toContain("nDCG@10 0.800");
    expect(line).toContain("P@10 0.700");
    expect(line).toContain("recall 0.900");
    expect(line).toContain("rank1Must yes");
  });

  it("includes cost when present", () => {
    const r: PerFixtureResult = {
      fixtureId: "f1",
      score: baseScore,
      cost: { tokensIn: 100, tokensOut: 50, usd: 0.001, cacheHit: false, promptHash: "abc" },
    };
    expect(formatPrettyLine(r)).toContain("cost $0.0010");
  });

  it("includes delta when previousNdcgAt10 is set", () => {
    const r: PerFixtureResult = {
      fixtureId: "f1",
      score: baseScore,
      previousNdcgAt10: 0.75,
    };
    const line = formatPrettyLine(r);
    expect(line).toContain("Δ +0.050");
  });
});

describe("formatEvalOutput", () => {
  const aggregate: AggregateResult = {
    meanNdcgAt10: 0.8,
    totalCost: 0.002,
    succeeded: 1,
    failed: 0,
    sourcingReport: [],
  };

  it("writes JSON when json=true", () => {
    const lines: string[] = [];
    const r: PerFixtureResult = { fixtureId: "f1", score: baseScore };
    formatEvalOutput([r], aggregate, { json: true }, (s) => lines.push(s));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { exitCode: number };
    expect(parsed.exitCode).toBe(0);
  });

  it("writes pretty lines when json=false", () => {
    const lines: string[] = [];
    const r: PerFixtureResult = { fixtureId: "f1", score: baseScore };
    formatEvalOutput([r], aggregate, { json: false }, (s) => lines.push(s));
    expect(lines[0]).toContain("[f1]");
    expect(lines[1]).toContain("aggregate:");
  });

  it("strips perItemDiff in json mode when diff=false", () => {
    const lines: string[] = [];
    const r: PerFixtureResult = {
      fixtureId: "f1",
      score: { ...baseScore, perItemDiff: [{ rawItemId: 1, title: "x", tier: "must", rank: 1, deltaRank: 0 }] },
    };
    formatEvalOutput([r], aggregate, { json: true, diff: false }, (s) => lines.push(s));
    const parsed = JSON.parse(lines[0]) as { perFixture: { score: Record<string, unknown> }[] };
    expect(parsed.perFixture[0].score.perItemDiff).toBeUndefined();
  });

  it("includes sourcing report lines", () => {
    const lines: string[] = [];
    const agg: AggregateResult = {
      ...aggregate,
      sourcingReport: [{ sourceType: "hn", mustIncludeCount: 3, niceCount: 2, dropCount: 1 }],
    };
    formatEvalOutput([], agg, {}, (s) => lines.push(s));
    expect(lines.some((l) => l.includes("hn"))).toBe(true);
  });
});

describe("runFixtureEval", () => {
  it("returns error result when ground truth is null", async () => {
    const { result, graded } = await runFixtureEval({
      fixture: { fixtureId: "f1", pool: [], model: "m" } as Parameters<typeof runFixtureEval>[0]["fixture"],
      prompt: "p",
      cache: {} as Parameters<typeof runFixtureEval>[0]["cache"],
      history: {},
      runEvalFn: vi.fn(),
      readGroundTruth: vi.fn().mockResolvedValue(null),
      recordScore: vi.fn(),
    });
    expect(result.error).toBe("no ground truth");
    expect(graded).toBeNull();
  });

  it("returns error result when runEval returns null score", async () => {
    const { result } = await runFixtureEval({
      fixture: { fixtureId: "f1", pool: [], model: "m" } as Parameters<typeof runFixtureEval>[0]["fixture"],
      prompt: "p",
      cache: {} as Parameters<typeof runFixtureEval>[0]["cache"],
      history: {},
      runEvalFn: vi.fn().mockResolvedValue({ score: null, cost: { tokensIn: 0, tokensOut: 0, usd: 0, cacheHit: false, promptHash: "" } }),
      readGroundTruth: vi.fn().mockResolvedValue({ fixtureId: "f1", gradedAt: "2025-01-01", items: [] }),
      recordScore: vi.fn(),
    });
    expect(result.error).toBe("runEval returned null score");
  });

  it("catches thrown errors", async () => {
    const { result } = await runFixtureEval({
      fixture: { fixtureId: "f1", pool: [], model: "m" } as Parameters<typeof runFixtureEval>[0]["fixture"],
      prompt: "p",
      cache: {} as Parameters<typeof runFixtureEval>[0]["cache"],
      history: {},
      runEvalFn: vi.fn().mockRejectedValue(new Error("network timeout")),
      readGroundTruth: vi.fn().mockResolvedValue({ fixtureId: "f1", gradedAt: "2025-01-01", items: [] }),
      recordScore: vi.fn(),
    });
    expect(result.error).toBe("network timeout");
  });
});
