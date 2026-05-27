export type CostStage =
  | "web-discovery"
  | "web-extraction"
  | "shortlist"
  | "rank"
  | "recap"
  | "digest";

export type StageCostStatus = "ok" | "partial-unknown-model" | "all-unknown-model";

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
  calls: number;
  costUsd: number | null;
}

export interface StageCost {
  calls: number;
  costUsd: number | null;
  costStatus: StageCostStatus;
  byModel: ModelStageCost[];
}

export interface RunCostBreakdown {
  schemaVersion: 1;
  totalCostUsd: number | null;
  stages: Partial<Record<CostStage, StageCost>>;
  unknownModels: string[];
  generatedAt: string;
}
