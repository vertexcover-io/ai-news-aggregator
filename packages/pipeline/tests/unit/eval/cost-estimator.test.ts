import { describe, expect, it } from "vitest";

import {
  estimateCost,
  HEURISTIC_INPUT_TOKENS_PER_FIXTURE,
  HEURISTIC_OUTPUT_TOKENS_PER_FIXTURE,
} from "@pipeline/eval/cost-estimator.js";

describe("estimateCost", () => {
  it("multiplies tokens by fixture count for known models", () => {
    const result = estimateCost(10, "claude-haiku-4-5-20251001");
    expect(result.tokensIn).toBe(10 * HEURISTIC_INPUT_TOKENS_PER_FIXTURE);
    expect(result.tokensOut).toBe(10 * HEURISTIC_OUTPUT_TOKENS_PER_FIXTURE);
    expect(result.usd).not.toBeNull();
    // haiku: 1.0 in + 5.0 out per M tok
    // 60_000 in * 1.0/M + 30_000 out * 5.0/M = 0.06 + 0.15 = 0.21
    expect(result.usd).toBeCloseTo(0.21, 4);
  });

  it("returns null usd for unknown models", () => {
    const result = estimateCost(5, "made-up-model-id");
    expect(result.usd).toBeNull();
    expect(result.tokensIn).toBe(5 * HEURISTIC_INPUT_TOKENS_PER_FIXTURE);
  });

  it("zero fixtures returns zero", () => {
    const result = estimateCost(0, "claude-haiku-4-5-20251001");
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
    expect(result.usd).toBe(0);
  });
});
