import { describe, expect, it } from "vitest";
import type { RunCostBreakdown } from "@newsletter/shared";
import { createCostTracker } from "@pipeline/services/cost-tracker.js";

const PRICED = "claude-haiku-4-5-20251001";
const UNPRICED = "made-up-experimental";
const GEMINI = "gemini-3.1-flash-lite";

function usage(input: number, output: number) {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cachedInputTokens: 0,
  };
}

describe("createCostTracker", () => {
  it("REQ-020: returns object with record/snapshot/merge/hasAnyCalls", () => {
    const tracker = createCostTracker("run-1");
    expect(typeof tracker.record).toBe("function");
    expect(typeof tracker.snapshot).toBe("function");
    expect(typeof tracker.merge).toBe("function");
    expect(typeof tracker.hasAnyCalls).toBe("function");
  });

  it("REQ-021: two records with same stage+model accumulate into a single byModel entry with calls=2", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(100, 50) });
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(200, 25) });
    const snap = tracker.snapshot();
    const stage = snap.stages.rank;
    expect(stage).toBeDefined();
    expect(stage?.byModel.length).toBe(1);
    expect(stage?.byModel[0].calls).toBe(2);
    expect(stage?.byModel[0].inputTokens).toBe(300);
    expect(stage?.byModel[0].outputTokens).toBe(75);
    expect(stage?.calls).toBe(2);
  });

  it("REQ-022 + REQ-026: partial-unknown-model when one priced + one unpriced; unknownModels has the unpriced id once", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(1_000_000, 0) });
    tracker.record({ stage: "rank", modelId: UNPRICED, usage: usage(100, 50) });
    const snap = tracker.snapshot();
    const stage = snap.stages.rank;
    expect(stage?.costStatus).toBe("partial-unknown-model");
    expect(stage?.costUsd).toBeCloseTo(1.0, 6);
    expect(snap.unknownModels).toEqual([UNPRICED]);
  });

  it("REQ-023: all-unknown-model when every model is unpriced; costUsd === null", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: UNPRICED, usage: usage(100, 50) });
    const snap = tracker.snapshot();
    expect(snap.stages.rank?.costStatus).toBe("all-unknown-model");
    expect(snap.stages.rank?.costUsd).toBeNull();
  });

  it("REQ-024: costStatus ok when every model is priced", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(100, 50) });
    const snap = tracker.snapshot();
    expect(snap.stages.rank?.costStatus).toBe("ok");
  });

  it("REQ-026: no duplicates in unknownModels when same unknown model recorded twice", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: UNPRICED, usage: usage(100, 0) });
    tracker.record({ stage: "recap", modelId: UNPRICED, usage: usage(50, 0) });
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(100, 0) });
    const snap = tracker.snapshot();
    expect(snap.unknownModels).toEqual([UNPRICED]);
  });

  it("REQ-027: totalCostUsd sums non-null stages and is null only when every stage is null", () => {
    const tracker1 = createCostTracker("run-1");
    tracker1.record({ stage: "rank", modelId: PRICED, usage: usage(1_000_000, 0) });
    tracker1.record({ stage: "recap", modelId: UNPRICED, usage: usage(100, 50) });
    const snap1 = tracker1.snapshot();
    expect(snap1.totalCostUsd).not.toBeNull();
    expect(snap1.totalCostUsd).toBeCloseTo(1.0, 6);

    const tracker2 = createCostTracker("run-2");
    tracker2.record({ stage: "rank", modelId: UNPRICED, usage: usage(100, 50) });
    expect(tracker2.snapshot().totalCostUsd).toBeNull();
  });

  it("REQ-025: merge(existing) accumulates prior counts before new records", () => {
    const existing: RunCostBreakdown = {
      schemaVersion: 1,
      totalCostUsd: 0.001,
      generatedAt: "2026-01-01T00:00:00.000Z",
      unknownModels: [],
      stages: {
        rank: {
          calls: 1,
          costUsd: 0.001,
          costStatus: "ok",
          byModel: [
            {
              modelId: PRICED,
              calls: 1,
              inputTokens: 1000,
              outputTokens: 0,
              cachedInputTokens: 0,
              cacheCreation5mTokens: 0,
              cacheCreation1hTokens: 0,
              reasoningTokens: 0,
              costUsd: 0.001,
            },
          ],
        },
      },
    };
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(1000, 0) });
    const snap = tracker.merge(existing);
    const stage = snap.stages.rank;
    expect(stage?.byModel[0].calls).toBe(2);
    expect(stage?.byModel[0].inputTokens).toBe(2000);
    expect(stage?.calls).toBe(2);
  });

  it("REQ-042: schemaVersion is always 1", () => {
    const tracker = createCostTracker("run-1");
    expect(tracker.snapshot().schemaVersion).toBe(1);
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(1, 1) });
    expect(tracker.snapshot().schemaVersion).toBe(1);
  });

  it("EDGE-006: merge(null) behaves as a fresh tracker", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "recap", modelId: PRICED, usage: usage(100, 0) });
    const merged = tracker.merge(null);
    expect(merged.stages.recap?.byModel[0].calls).toBe(1);
  });

  it("EDGE-011: merge(existing with schemaVersion 2) treats existing as null", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(100, 0) });
    const wrong = { schemaVersion: 2, stages: {} } as unknown as RunCostBreakdown;
    const merged = tracker.merge(wrong);
    expect(merged.stages.rank?.byModel[0].calls).toBe(1);
  });

  it("hasAnyCalls returns false before any record(), true after", () => {
    const tracker = createCostTracker("run-1");
    expect(tracker.hasAnyCalls()).toBe(false);
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(1, 1) });
    expect(tracker.hasAnyCalls()).toBe(true);
  });

  it("hasAnyCalls returns true after merging non-empty existing", () => {
    const existing: RunCostBreakdown = {
      schemaVersion: 1,
      totalCostUsd: 0.001,
      generatedAt: "2026-01-01T00:00:00.000Z",
      unknownModels: [],
      stages: {
        rank: {
          calls: 1,
          costUsd: 0.001,
          costStatus: "ok",
          byModel: [
            {
              modelId: PRICED,
              calls: 1,
              inputTokens: 1000,
              outputTokens: 0,
              cachedInputTokens: 0,
              cacheCreation5mTokens: 0,
              cacheCreation1hTokens: 0,
              reasoningTokens: 0,
              costUsd: 0.001,
            },
          ],
        },
      },
    };
    const tracker = createCostTracker("run-1");
    tracker.merge(existing);
    expect(tracker.hasAnyCalls()).toBe(true);
  });

  it("REQ-004: web-discovery on gemini prices via the gemini path (input 0.25 / output 1.5 per MTok)", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({
      stage: "web-discovery",
      modelId: GEMINI,
      usage: { inputTokens: 147, outputTokens: 191, totalTokens: 338 },
      providerMetadata: { google: {} },
    });
    const snap = tracker.snapshot();
    const stage = snap.stages["web-discovery"];
    expect(stage).toBeDefined();
    expect(stage?.byModel.length).toBe(1);
    expect(stage?.byModel[0].modelId).toBe(GEMINI);
    expect(stage?.byModel[0].calls).toBe(1);
    expect(stage?.calls).toBe(1);
    expect(stage?.costStatus).toBe("ok");
    // 147 * 0.25 + 191 * 1.5 = 323.25, / 1e6 = 0.00032325
    expect(stage?.costUsd).toBeCloseTo(0.00032325, 9);
    expect(stage?.byModel[0].costUsd).toBeCloseTo(0.00032325, 9);
  });

  it("REQ-006: gemini record with no providerMetadata.anthropic still yields zero cache-tier tokens", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({
      stage: "web-discovery",
      modelId: GEMINI,
      usage: { inputTokens: 147, outputTokens: 191, totalTokens: 338 },
      providerMetadata: { google: {} },
    });
    const m = tracker.snapshot().stages["web-discovery"]?.byModel[0];
    expect(m?.inputTokens).toBe(147);
    expect(m?.outputTokens).toBe(191);
    expect(m?.cachedInputTokens).toBe(0);
    expect(m?.cacheCreation5mTokens).toBe(0);
    expect(m?.cacheCreation1hTokens).toBe(0);
    expect(m?.reasoningTokens).toBe(0);
  });

  it("EDGE-002: gemini web-discovery + anthropic rank in one tracker — totalCostUsd sums both, both ids present, unknownModels empty", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({
      stage: "web-discovery",
      modelId: GEMINI,
      usage: { inputTokens: 147, outputTokens: 191, totalTokens: 338 },
      providerMetadata: { google: {} },
    });
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(1_000_000, 0) });
    const snap = tracker.snapshot();
    expect(snap.stages["web-discovery"]?.byModel[0].modelId).toBe(GEMINI);
    expect(snap.stages.rank?.byModel[0].modelId).toBe(PRICED);
    // gemini stage = 0.00032325, rank stage = 1.0
    expect(snap.totalCostUsd).toBeCloseTo(1.0 + 0.00032325, 9);
    expect(snap.unknownModels).toEqual([]);
  });

  it("EDGE-005: same stage with two different model ids tracked separately", () => {
    const tracker = createCostTracker("run-1");
    tracker.record({ stage: "rank", modelId: PRICED, usage: usage(100, 50) });
    tracker.record({ stage: "rank", modelId: "claude-sonnet-4-6", usage: usage(200, 100) });
    const snap = tracker.snapshot();
    expect(snap.stages.rank?.byModel.length).toBe(2);
    const ids = snap.stages.rank?.byModel.map((m) => m.modelId).sort();
    expect(ids).toEqual([PRICED, "claude-sonnet-4-6"].sort());
  });
});
