import { describe, expect, it } from "vitest";
import { MODEL_PRICING, type ModelPricing } from "@shared/pricing.js";

describe("MODEL_PRICING (REQ-001)", () => {
  it("contains the verified model ids", () => {
    expect(Object.keys(MODEL_PRICING).sort()).toEqual(
      [
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-6",
        "deepseek-chat",
        "gemini-3.1-flash-lite",
      ].sort(),
    );
  });

  it("deepseek-chat rates match official DeepSeek V4 Flash pricing (REQ-004/REQ-016)", () => {
    expect(MODEL_PRICING["deepseek-chat"]).toEqual({
      inputPerMTok: 0.14,
      outputPerMTok: 0.28,
      cacheReadPerMTok: 0.0028,
      cacheWrite5mPerMTok: 0,
      cacheWrite1hPerMTok: 0,
    });
  });

  it("gemini-3.1-flash-lite rates match design values (REQ-005)", () => {
    expect(MODEL_PRICING["gemini-3.1-flash-lite"]).toEqual({
      inputPerMTok: 0.25,
      outputPerMTok: 1.5,
      cacheReadPerMTok: 0.025,
      cacheWrite5mPerMTok: 0,
      cacheWrite1hPerMTok: 0,
    });
  });

  it("existing Anthropic entries remain present and unchanged (REQ-005/EDGE-004)", () => {
    expect(MODEL_PRICING["claude-haiku-4-5-20251001"]).toEqual({
      inputPerMTok: 1.0,
      outputPerMTok: 5.0,
      cacheReadPerMTok: 0.1,
      cacheWrite5mPerMTok: 1.25,
      cacheWrite1hPerMTok: 2.0,
    });
    expect(MODEL_PRICING["claude-sonnet-4-6"]).toEqual({
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
      cacheReadPerMTok: 0.3,
      cacheWrite5mPerMTok: 3.75,
      cacheWrite1hPerMTok: 6.0,
    });
  });

  it("sonnet 4.5 rates match published values", () => {
    expect(MODEL_PRICING["claude-sonnet-4-5-20250929"]).toEqual({
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
      cacheReadPerMTok: 0.3,
      cacheWrite5mPerMTok: 3.75,
      cacheWrite1hPerMTok: 6.0,
    });
  });
});

describe("ModelPricing shape (REQ-002)", () => {
  it("has exactly five rate fields, no reasoningPerMTok", () => {
    const haiku = MODEL_PRICING["claude-haiku-4-5-20251001"];
    expect(haiku).toBeDefined();
    if (!haiku) return;
    const keys = Object.keys(haiku).sort();
    expect(keys).toEqual(
      [
        "inputPerMTok",
        "outputPerMTok",
        "cacheReadPerMTok",
        "cacheWrite5mPerMTok",
        "cacheWrite1hPerMTok",
      ].sort(),
    );
    const pricing: ModelPricing = haiku;
    // @ts-expect-error reasoningPerMTok must not exist on ModelPricing
    const _r: number = pricing.reasoningPerMTok;
    void _r;
  });
});
