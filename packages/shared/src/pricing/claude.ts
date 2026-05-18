import type { ClaudePricing } from "../types/cost.js";

const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const LAST_VERIFIED = "2026-05-18";

export const CLAUDE_PRICING: Record<string, ClaudePricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    lastVerified: LAST_VERIFIED,
    source: PRICING_SOURCE,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    lastVerified: LAST_VERIFIED,
    source: PRICING_SOURCE,
  },
  "claude-opus-4-7": {
    inputPerMTok: 5,
    outputPerMTok: 25,
    lastVerified: LAST_VERIFIED,
    source: PRICING_SOURCE,
  },
};

const TOKENS_PER_MTOK = 1_000_000;

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export interface ComputeUsdCostResult {
  usdCost: number;
  unknownModel: boolean;
}

export function computeUsdCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): ComputeUsdCostResult {
  if (!Object.prototype.hasOwnProperty.call(CLAUDE_PRICING, modelId)) {
    return { usdCost: 0, unknownModel: true };
  }
  const pricing = CLAUDE_PRICING[modelId];
  const inputCost = (inputTokens / TOKENS_PER_MTOK) * pricing.inputPerMTok;
  const outputCost = (outputTokens / TOKENS_PER_MTOK) * pricing.outputPerMTok;
  return { usdCost: round6(inputCost + outputCost), unknownModel: false };
}

export function getPricingLastVerified(modelId: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(CLAUDE_PRICING, modelId)) {
    return null;
  }
  return CLAUDE_PRICING[modelId].lastVerified;
}
