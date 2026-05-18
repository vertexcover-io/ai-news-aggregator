import type { ClaudePricing } from "../types/cost.js";

const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const LAST_VERIFIED = "2026-05-18";

function pricing(inputPerMTok: number, outputPerMTok: number): ClaudePricing {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheWrite5mPerMTok: inputPerMTok * 1.25,
    cacheWrite1hPerMTok: inputPerMTok * 2,
    cacheReadPerMTok: inputPerMTok * 0.1,
    lastVerified: LAST_VERIFIED,
    source: PRICING_SOURCE,
  };
}

export const CLAUDE_PRICING: Record<string, ClaudePricing> = {
  "claude-haiku-4-5": pricing(1, 5),
  "claude-haiku-4-5-20251001": pricing(1, 5),
  "claude-sonnet-4-5": pricing(3, 15),
  "claude-sonnet-4-5-20250929": pricing(3, 15),
  "claude-sonnet-4-6": pricing(3, 15),
  "claude-opus-4-5": pricing(5, 25),
  "claude-opus-4-6": pricing(5, 25),
  "claude-opus-4-7": pricing(5, 25),
};

const TOKENS_PER_MTOK = 1_000_000;

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export interface ComputeUsdCostResult {
  usdCost: number;
  inputUsdCost: number;
  outputUsdCost: number;
  cacheCreationInputUsdCost: number;
  cacheCreation5mInputUsdCost: number;
  cacheCreation1hInputUsdCost: number;
  cacheReadInputUsdCost: number;
  unknownModel: boolean;
}

export interface ComputeUsdCostInput {
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheCreation5mInputTokens?: number;
  readonly cacheCreation1hInputTokens?: number;
  readonly cacheReadInputTokens?: number;
}

export function computeUsdCost(input: ComputeUsdCostInput): ComputeUsdCostResult {
  if (!Object.prototype.hasOwnProperty.call(CLAUDE_PRICING, input.modelId)) {
    return {
      usdCost: 0,
      inputUsdCost: 0,
      outputUsdCost: 0,
      cacheCreationInputUsdCost: 0,
      cacheCreation5mInputUsdCost: 0,
      cacheCreation1hInputUsdCost: 0,
      cacheReadInputUsdCost: 0,
      unknownModel: true,
    };
  }
  const pricing = CLAUDE_PRICING[input.modelId];
  const inputUsdCost =
    (input.inputTokens / TOKENS_PER_MTOK) * pricing.inputPerMTok;
  const outputUsdCost =
    (input.outputTokens / TOKENS_PER_MTOK) * pricing.outputPerMTok;
  const hasTtlSplit =
    input.cacheCreation5mInputTokens !== undefined ||
    input.cacheCreation1hInputTokens !== undefined;
  const cacheCreation5mInputTokens = hasTtlSplit
    ? (input.cacheCreation5mInputTokens ?? 0)
    : (input.cacheCreationInputTokens ?? 0);
  const cacheCreation1hInputTokens = input.cacheCreation1hInputTokens ?? 0;
  const cacheCreation5mInputUsdCost =
    (cacheCreation5mInputTokens / TOKENS_PER_MTOK) *
    pricing.cacheWrite5mPerMTok;
  const cacheCreation1hInputUsdCost =
    (cacheCreation1hInputTokens / TOKENS_PER_MTOK) *
    pricing.cacheWrite1hPerMTok;
  const cacheCreationInputUsdCost =
    cacheCreation5mInputUsdCost + cacheCreation1hInputUsdCost;
  const cacheReadInputUsdCost =
    ((input.cacheReadInputTokens ?? 0) / TOKENS_PER_MTOK) *
    pricing.cacheReadPerMTok;
  return {
    usdCost: round6(
      inputUsdCost +
        outputUsdCost +
        cacheCreationInputUsdCost +
        cacheReadInputUsdCost,
    ),
    inputUsdCost: round6(inputUsdCost),
    outputUsdCost: round6(outputUsdCost),
    cacheCreationInputUsdCost: round6(cacheCreationInputUsdCost),
    cacheCreation5mInputUsdCost: round6(cacheCreation5mInputUsdCost),
    cacheCreation1hInputUsdCost: round6(cacheCreation1hInputUsdCost),
    cacheReadInputUsdCost: round6(cacheReadInputUsdCost),
    unknownModel: false,
  };
}

export function getPricingLastVerified(modelId: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(CLAUDE_PRICING, modelId)) {
    return null;
  }
  return CLAUDE_PRICING[modelId].lastVerified;
}
