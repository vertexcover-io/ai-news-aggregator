export type LlmStage = "webListing" | "webExtraction" | "rank" | "recap";

export interface StageCost {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  usdCost: number;
  model: string;
  missingUsageCallCount?: number;
  unknownModelCallCount?: number;
}

export interface RunCostBreakdown {
  stages: Partial<Record<LlmStage, StageCost>>;
  totalUsdCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  capturedAt: string;
}

export interface ClaudePricing {
  inputPerMTok: number;
  outputPerMTok: number;
  lastVerified: string;
  source: string;
}
