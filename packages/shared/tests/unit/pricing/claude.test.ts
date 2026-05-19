import { describe, expect, it } from "vitest";
import { CLAUDE_PRICING, computeUsdCost } from "@shared/pricing/claude.js";

describe("CLAUDE_PRICING", () => {
  it("VS-0a: claude-haiku-4-5-20251001 matches verified rates", () => {
    expect(CLAUDE_PRICING["claude-haiku-4-5-20251001"]).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 5,
      lastVerified: "2026-05-18",
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
    });
  });

  it("includes sonnet and opus entries with lastVerified", () => {
    expect(CLAUDE_PRICING["claude-sonnet-4-6"].lastVerified).toBe("2026-05-18");
    expect(CLAUDE_PRICING["claude-opus-4-7"].lastVerified).toBe("2026-05-18");
  });
});

describe("computeUsdCost", () => {
  it("VS-0b: known model returns expected USD", () => {
    expect(computeUsdCost("claude-haiku-4-5-20251001", 1000, 500)).toEqual({
      usdCost: 0.0035,
      unknownModel: false,
    });
  });

  it("VS-0b: unknown model returns zero and unknownModel=true", () => {
    expect(computeUsdCost("future-model-xyz", 1000, 500)).toEqual({
      usdCost: 0,
      unknownModel: true,
    });
  });

  it("handles zero tokens", () => {
    expect(computeUsdCost("claude-haiku-4-5-20251001", 0, 0).usdCost).toBe(0);
  });

  it("rounds to 6 decimals", () => {
    const r = computeUsdCost("claude-haiku-4-5-20251001", 1, 1);
    expect(r.usdCost).toBe(0.000006);
  });
});
