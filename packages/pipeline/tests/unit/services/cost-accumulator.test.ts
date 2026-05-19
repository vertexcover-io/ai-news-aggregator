import { describe, expect, it } from "vitest";
import { RunCostAccumulator } from "@pipeline/services/cost-accumulator.js";

const HAIKU = "claude-haiku-4-5-20251001";

describe("RunCostAccumulator", () => {
  it("VS-1: records and snapshots multiple stages correctly", () => {
    const acc = new RunCostAccumulator();
    acc.record(
      "rank",
      {
        usage: { promptTokens: 1000, completionTokens: 500 },
        response: { modelId: HAIKU },
      },
      HAIKU,
    );
    acc.record(
      "rank",
      {
        usage: { promptTokens: 1000, completionTokens: 500 },
        response: { modelId: HAIKU },
      },
      HAIKU,
    );
    acc.record(
      "recap",
      {
        usage: { promptTokens: 2000, completionTokens: 1000 },
        response: { modelId: HAIKU },
      },
      HAIKU,
    );

    const snap = acc.snapshot();
    expect(snap.stages.rank).toEqual({
      inputTokens: 2000,
      outputTokens: 1000,
      callCount: 2,
      usdCost: 0.007,
      model: HAIKU,
    });
    expect(snap.stages.recap).toEqual({
      inputTokens: 2000,
      outputTokens: 1000,
      callCount: 1,
      usdCost: 0.007,
      model: HAIKU,
    });
    expect(snap.totalUsdCost).toBe(0.014);
    expect(snap.totalInputTokens).toBe(4000);
    expect(snap.totalOutputTokens).toBe(2000);
    expect(typeof snap.capturedAt).toBe("string");
  });

  it("VS-2: missing usage is handled gracefully", () => {
    const acc = new RunCostAccumulator();
    expect(() =>
      acc.record(
        "rank",
        { usage: undefined, response: { modelId: HAIKU } },
        HAIKU,
      ),
    ).not.toThrow();

    const snap = acc.snapshot();
    const rank = snap.stages.rank;
    expect(rank).toBeDefined();
    if (!rank) throw new Error("unreachable");
    expect(rank.missingUsageCallCount).toBe(1);
    expect(rank.inputTokens).toBe(0);
    expect(rank.outputTokens).toBe(0);
    expect(rank.usdCost).toBe(0);
    expect(rank.callCount).toBe(1);
  });

  it("records unknown model with zero cost and increments counter", () => {
    const acc = new RunCostAccumulator();
    acc.record(
      "rank",
      {
        usage: { promptTokens: 100, completionTokens: 50 },
        response: { modelId: "future-model-xyz" },
      },
      "future-model-xyz",
    );
    const snap = acc.snapshot();
    const rank = snap.stages.rank;
    if (!rank) throw new Error("unreachable");
    expect(rank.unknownModelCallCount).toBe(1);
    expect(rank.usdCost).toBe(0);
    expect(rank.inputTokens).toBe(100);
    expect(rank.outputTokens).toBe(50);
  });

  it("hasAnyData reflects whether any records exist", () => {
    const acc = new RunCostAccumulator();
    expect(acc.hasAnyData()).toBe(false);
    acc.record(
      "rank",
      {
        usage: { promptTokens: 1, completionTokens: 1 },
        response: { modelId: HAIKU },
      },
      HAIKU,
    );
    expect(acc.hasAnyData()).toBe(true);
  });
});
