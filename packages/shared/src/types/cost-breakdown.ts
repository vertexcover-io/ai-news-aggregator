export type CostStage = "rerank" | "digest" | "social" | "other";

export interface CostComponents {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  reasoningTokens: number;
}

export interface ModelStageCost extends CostComponents {
  modelId: string;
  callCount: number;
  costUsd: number | null;
}

export interface StageCost {
  stage: CostStage;
  totalCostUsd: number | null;
  callCount: number;
  models: ModelStageCost[];
}

export interface RunCostBreakdown {
  schemaVersion: 1;
  totalCostUsd: number | null;
  stages: StageCost[];
}
