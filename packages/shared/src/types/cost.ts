export type LlmStage = "webListing" | "webExtraction" | "rank" | "recap";

export interface StageCost {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheCreationInputTokens?: number;
  cacheCreation5mInputTokens?: number;
  cacheCreation1hInputTokens?: number;
  cacheReadInputTokens?: number;
  callCount: number;
  usdCost: number;
  inputUsdCost?: number;
  outputUsdCost?: number;
  cacheCreationInputUsdCost?: number;
  cacheCreation5mInputUsdCost?: number;
  cacheCreation1hInputUsdCost?: number;
  cacheReadInputUsdCost?: number;
  model: string;
  missingUsageCallCount?: number;
  unknownModelCallCount?: number;
  rawUsage?: readonly Record<string, unknown>[];
}

export interface RunCostBreakdown {
  stages: Partial<Record<LlmStage, StageCost>>;
  totalUsdCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens?: number;
  totalReasoningTokens?: number;
  totalCacheCreationInputTokens?: number;
  totalCacheCreation5mInputTokens?: number;
  totalCacheCreation1hInputTokens?: number;
  totalCacheReadInputTokens?: number;
  totalInputUsdCost?: number;
  totalOutputUsdCost?: number;
  totalCacheCreationInputUsdCost?: number;
  totalCacheCreation5mInputUsdCost?: number;
  totalCacheCreation1hInputUsdCost?: number;
  totalCacheReadInputUsdCost?: number;
  capturedAt: string;
}

export interface ClaudePricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  lastVerified: string;
  source: string;
}
