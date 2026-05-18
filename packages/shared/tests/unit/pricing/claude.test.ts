import { describe, expect, it } from "vitest";
import { CLAUDE_PRICING, computeUsdCost } from "@shared/pricing/claude.js";

describe("CLAUDE_PRICING", () => {
  it("VS-0a: claude-haiku-4-5-20251001 matches verified rates", () => {
    expect(CLAUDE_PRICING["claude-haiku-4-5-20251001"]).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheWrite5mPerMTok: 1.25,
      cacheWrite1hPerMTok: 2,
      cacheReadPerMTok: 0.1,
      lastVerified: "2026-05-18",
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
    });
  });

  it("includes sonnet and opus entries with lastVerified", () => {
    expect(CLAUDE_PRICING["claude-sonnet-4-5"].lastVerified).toBe("2026-05-18");
    expect(CLAUDE_PRICING["claude-sonnet-4-5-20250929"].lastVerified).toBe(
      "2026-05-18",
    );
    expect(CLAUDE_PRICING["claude-sonnet-4-6"].lastVerified).toBe("2026-05-18");
    expect(CLAUDE_PRICING["claude-opus-4-5"].lastVerified).toBe("2026-05-18");
    expect(CLAUDE_PRICING["claude-opus-4-6"].lastVerified).toBe("2026-05-18");
    expect(CLAUDE_PRICING["claude-opus-4-7"].lastVerified).toBe("2026-05-18");
  });
});

describe("computeUsdCost", () => {
  it("VS-0b: known model returns expected USD", () => {
    expect(
      computeUsdCost({
        modelId: "claude-haiku-4-5-20251001",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ).toEqual({
      usdCost: 0.0035,
      inputUsdCost: 0.001,
      outputUsdCost: 0.0025,
      cacheCreationInputUsdCost: 0,
      cacheCreation5mInputUsdCost: 0,
      cacheCreation1hInputUsdCost: 0,
      cacheReadInputUsdCost: 0,
      unknownModel: false,
    });
  });

  it("VS-0b: unknown model returns zero and unknownModel=true", () => {
    expect(
      computeUsdCost({
        modelId: "future-model-xyz",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ).toEqual({
      usdCost: 0,
      inputUsdCost: 0,
      outputUsdCost: 0,
      cacheCreationInputUsdCost: 0,
      cacheCreation5mInputUsdCost: 0,
      cacheCreation1hInputUsdCost: 0,
      cacheReadInputUsdCost: 0,
      unknownModel: true,
    });
  });

  it("handles zero tokens", () => {
    expect(
      computeUsdCost({
        modelId: "claude-haiku-4-5-20251001",
        inputTokens: 0,
        outputTokens: 0,
      }).usdCost,
    ).toBe(0);
  });

  it("rounds to 6 decimals", () => {
    const r = computeUsdCost({
      modelId: "claude-haiku-4-5-20251001",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(r.usdCost).toBe(0.000006);
  });

  it("prices current aliases and returned model IDs directly", () => {
    expect(
      computeUsdCost({
        modelId: "claude-haiku-4-5",
        inputTokens: 1000,
        outputTokens: 500,
      }).usdCost,
    ).toBe(0.0035);
    expect(
      computeUsdCost({
        modelId: "claude-sonnet-4-5-20250929",
        inputTokens: 1000,
        outputTokens: 500,
      }).usdCost,
    ).toBe(0.0105);
    expect(
      computeUsdCost({
        modelId: "claude-opus-4-6",
        inputTokens: 1000,
        outputTokens: 500,
      }).usdCost,
    ).toBe(0.0175);
  });

  it("prices cache creation and cache reads", () => {
    expect(
      computeUsdCost({
        modelId: "claude-haiku-4-5",
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationInputTokens: 1000,
        cacheReadInputTokens: 1000,
      }),
    ).toEqual({
      inputUsdCost: 0.001,
      outputUsdCost: 0.0025,
      cacheCreationInputUsdCost: 0.00125,
      cacheCreation5mInputUsdCost: 0.00125,
      cacheCreation1hInputUsdCost: 0,
      cacheReadInputUsdCost: 0.0001,
      usdCost: 0.00485,
      unknownModel: false,
    });
  });

  it("prices 5-minute and 1-hour cache writes separately when available", () => {
    expect(
      computeUsdCost({
        modelId: "claude-haiku-4-5",
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationInputTokens: 3000,
        cacheCreation5mInputTokens: 1000,
        cacheCreation1hInputTokens: 2000,
        cacheReadInputTokens: 1000,
      }),
    ).toEqual({
      inputUsdCost: 0.001,
      outputUsdCost: 0.0025,
      cacheCreationInputUsdCost: 0.00525,
      cacheCreation5mInputUsdCost: 0.00125,
      cacheCreation1hInputUsdCost: 0.004,
      cacheReadInputUsdCost: 0.0001,
      usdCost: 0.00885,
      unknownModel: false,
    });
  });
});
