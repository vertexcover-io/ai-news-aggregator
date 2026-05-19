import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type {
  CostStage,
  ModelStageCost,
  RunCostBreakdown,
  StageCost,
  StageCostStatus,
} from "@newsletter/shared";
import {
  MODEL_PRICING,
  computeCallCost,
  extractAnthropicUsage,
} from "@newsletter/shared";

export interface RecordInput {
  stage: CostStage;
  modelId: string;
  usage: LanguageModelUsage;
  providerMetadata?: ProviderMetadata;
}

export interface CostTracker {
  record(input: RecordInput): void;
  snapshot(): RunCostBreakdown;
  merge(existing: RunCostBreakdown | null): RunCostBreakdown;
  hasAnyCalls(): boolean;
}

interface ModelAccum {
  modelId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  reasoningTokens: number;
}

function newModelAccum(modelId: string): ModelAccum {
  return {
    modelId,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: 0,
  };
}

function priceModel(accum: ModelAccum): ModelStageCost {
  const { costUsd } = computeCallCost(
    {
      inputTokens: accum.inputTokens,
      outputTokens: accum.outputTokens,
      cachedInputTokens: accum.cachedInputTokens,
      cacheCreation5mTokens: accum.cacheCreation5mTokens,
      cacheCreation1hTokens: accum.cacheCreation1hTokens,
      reasoningTokens: accum.reasoningTokens,
    },
    accum.modelId,
  );
  return {
    modelId: accum.modelId,
    calls: accum.calls,
    inputTokens: accum.inputTokens,
    outputTokens: accum.outputTokens,
    cachedInputTokens: accum.cachedInputTokens,
    cacheCreation5mTokens: accum.cacheCreation5mTokens,
    cacheCreation1hTokens: accum.cacheCreation1hTokens,
    reasoningTokens: accum.reasoningTokens,
    costUsd,
  };
}

function stageStatus(byModel: ModelStageCost[]): StageCostStatus {
  const priced = byModel.filter((m) => m.costUsd !== null).length;
  const unpriced = byModel.length - priced;
  if (unpriced === 0) return "ok";
  if (priced === 0) return "all-unknown-model";
  return "partial-unknown-model";
}

function stageCostUsd(byModel: ModelStageCost[]): number | null {
  const priced = byModel.filter((m) => m.costUsd !== null);
  if (priced.length === 0) return null;
  return priced.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
}

export function createCostTracker(_runId: string): CostTracker {
  const stages = new Map<CostStage, Map<string, ModelAccum>>();
  let recordedAny = false;

  const ensure = (stage: CostStage, modelId: string): ModelAccum => {
    let perStage = stages.get(stage);
    if (!perStage) {
      perStage = new Map();
      stages.set(stage, perStage);
    }
    let entry = perStage.get(modelId);
    if (!entry) {
      entry = newModelAccum(modelId);
      perStage.set(modelId, entry);
    }
    return entry;
  };

  const ingestExisting = (existing: RunCostBreakdown | null): void => {
    if (existing === null) return;
    const version = (existing as { schemaVersion: number }).schemaVersion;
    if (version !== 1) return;
    const entries = Object.entries(existing.stages) as [
      CostStage,
      StageCost | undefined,
    ][];
    for (const [stage, stageVal] of entries) {
      if (stageVal === undefined) continue;
      for (const m of stageVal.byModel) {
        const accum = ensure(stage, m.modelId);
        accum.calls += m.calls;
        accum.inputTokens += m.inputTokens;
        accum.outputTokens += m.outputTokens;
        accum.cachedInputTokens += m.cachedInputTokens;
        accum.cacheCreation5mTokens += m.cacheCreation5mTokens;
        accum.cacheCreation1hTokens += m.cacheCreation1hTokens;
        accum.reasoningTokens += m.reasoningTokens;
        if (m.calls > 0) recordedAny = true;
      }
    }
  };

  const buildSnapshot = (): RunCostBreakdown => {
    const out: Partial<Record<CostStage, StageCost>> = {};
    const unknown = new Set<string>();
    let total: number | null = null;
    for (const [stage, perStage] of stages.entries()) {
      const byModel: ModelStageCost[] = [];
      for (const accum of perStage.values()) {
        if (accum.calls === 0) continue;
        const row = priceModel(accum);
        byModel.push(row);
        if (!(row.modelId in MODEL_PRICING)) unknown.add(row.modelId);
      }
      if (byModel.length === 0) continue;
      const costUsd = stageCostUsd(byModel);
      const calls = byModel.reduce((n, m) => n + m.calls, 0);
      out[stage] = {
        calls,
        costUsd,
        costStatus: stageStatus(byModel),
        byModel,
      };
      if (costUsd !== null) total = (total ?? 0) + costUsd;
    }
    return {
      schemaVersion: 1,
      totalCostUsd: total,
      stages: out,
      unknownModels: [...unknown],
      generatedAt: new Date().toISOString(),
    };
  };

  return {
    record(input: RecordInput): void {
      const components = extractAnthropicUsage(input.usage, input.providerMetadata);
      const accum = ensure(input.stage, input.modelId);
      accum.calls += 1;
      accum.inputTokens += components.inputTokens;
      accum.outputTokens += components.outputTokens;
      accum.cachedInputTokens += components.cachedInputTokens;
      accum.cacheCreation5mTokens += components.cacheCreation5mTokens;
      accum.cacheCreation1hTokens += components.cacheCreation1hTokens;
      accum.reasoningTokens += components.reasoningTokens;
      recordedAny = true;
    },
    snapshot(): RunCostBreakdown {
      return buildSnapshot();
    },
    merge(existing: RunCostBreakdown | null): RunCostBreakdown {
      ingestExisting(existing);
      return buildSnapshot();
    },
    hasAnyCalls(): boolean {
      return recordedAny;
    },
  };
}
