import { createLogger } from "@newsletter/shared/logger";
import { computeUsdCost } from "@newsletter/shared";
import type { LlmStage, RunCostBreakdown, StageCost } from "@newsletter/shared";

const logger = createLogger("service:cost-accumulator");

/**
 * Structural usage shape accepted by the accumulator. The Vercel AI SDK v5
 * returns `LanguageModelV2Usage` with `inputTokens`/`outputTokens`; older
 * versions used `promptTokens`/`completionTokens`. We accept either so the
 * accumulator survives an SDK bump.
 */
export interface LlmCallResult {
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    reasoningTokens?: number | null;
    cachedInputTokens?: number | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
  };
  response?: {
    modelId?: string;
  };
  providerMetadata?: {
    anthropic?: Record<string, unknown>;
  };
}

interface MutableStage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cacheCreationInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  cacheReadInputTokens: number;
  callCount: number;
  usdCost: number;
  inputUsdCost: number;
  outputUsdCost: number;
  cacheCreationInputUsdCost: number;
  cacheCreation5mInputUsdCost: number;
  cacheCreation1hInputUsdCost: number;
  cacheReadInputUsdCost: number;
  model: string;
  missingUsageCallCount: number;
  unknownModelCallCount: number;
  rawUsage: Record<string, unknown>[];
}

function emptyStage(): MutableStage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    cacheReadInputTokens: 0,
    callCount: 0,
    usdCost: 0,
    inputUsdCost: 0,
    outputUsdCost: 0,
    cacheCreationInputUsdCost: 0,
    cacheCreation5mInputUsdCost: 0,
    cacheCreation1hInputUsdCost: 0,
    cacheReadInputUsdCost: 0,
    model: "",
    missingUsageCallCount: 0,
    unknownModelCallCount: 0,
    rawUsage: [],
  };
}

function toStageCost(s: MutableStage): StageCost {
  const out: StageCost = {
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.totalTokens,
    reasoningTokens: s.reasoningTokens,
    cacheCreationInputTokens: s.cacheCreationInputTokens,
    cacheCreation5mInputTokens: s.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: s.cacheCreation1hInputTokens,
    cacheReadInputTokens: s.cacheReadInputTokens,
    callCount: s.callCount,
    usdCost: Math.round(s.usdCost * 1_000_000) / 1_000_000,
    inputUsdCost: Math.round(s.inputUsdCost * 1_000_000) / 1_000_000,
    outputUsdCost: Math.round(s.outputUsdCost * 1_000_000) / 1_000_000,
    cacheCreationInputUsdCost:
      Math.round(s.cacheCreationInputUsdCost * 1_000_000) / 1_000_000,
    cacheCreation5mInputUsdCost:
      Math.round(s.cacheCreation5mInputUsdCost * 1_000_000) / 1_000_000,
    cacheCreation1hInputUsdCost:
      Math.round(s.cacheCreation1hInputUsdCost * 1_000_000) / 1_000_000,
    cacheReadInputUsdCost:
      Math.round(s.cacheReadInputUsdCost * 1_000_000) / 1_000_000,
    model: s.model,
  };
  if (s.missingUsageCallCount > 0) {
    out.missingUsageCallCount = s.missingUsageCallCount;
  }
  if (s.unknownModelCallCount > 0) {
    out.unknownModelCallCount = s.unknownModelCallCount;
  }
  if (s.rawUsage.length > 0) {
    out.rawUsage = s.rawUsage;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function getAnthropicMetadata(
  result: LlmCallResult,
): Record<string, unknown> | null {
  return asRecord(result.providerMetadata?.anthropic);
}

function getRawAnthropicUsage(
  result: LlmCallResult,
): Record<string, unknown> | null {
  return asRecord(getAnthropicMetadata(result)?.usage);
}

function getCacheCreationInputTokens(result: LlmCallResult): number {
  const anthropic = getAnthropicMetadata(result);
  const rawUsage = asRecord(anthropic?.usage);
  return (
    getNumber(anthropic?.cacheCreationInputTokens) ??
    getNumber(rawUsage?.cache_creation_input_tokens) ??
    0
  );
}

function getCacheCreationTtlInputTokens(result: LlmCallResult): {
  aggregate: number;
  fiveMinute: number;
  oneHour: number;
} {
  const rawUsage = getRawAnthropicUsage(result);
  const cacheCreation = asRecord(rawUsage?.cache_creation);
  const fiveMinute =
    getNumber(cacheCreation?.ephemeral_5m_input_tokens) ?? 0;
  const oneHour = getNumber(cacheCreation?.ephemeral_1h_input_tokens) ?? 0;
  const aggregate = getCacheCreationInputTokens(result);
  if (fiveMinute > 0 || oneHour > 0) {
    return { aggregate: fiveMinute + oneHour, fiveMinute, oneHour };
  }
  return { aggregate, fiveMinute: aggregate, oneHour: 0 };
}

function getCacheReadInputTokens(result: LlmCallResult): number {
  const rawUsage = getRawAnthropicUsage(result);
  return (
    getNumber(result.usage?.cachedInputTokens) ??
    getNumber(rawUsage?.cache_read_input_tokens) ??
    0
  );
}

export class RunCostAccumulator {
  private readonly stages = new Map<LlmStage, MutableStage>();

  record(
    stage: LlmStage,
    result: LlmCallResult,
    fallbackModelId: string,
  ): void {
    const bucket = this.stages.get(stage) ?? emptyStage();

    const reportedModelId = result.response?.modelId ?? fallbackModelId;
    bucket.model = reportedModelId;
    bucket.callCount += 1;

    const usage = result.usage;
    const rawInput = usage?.inputTokens ?? usage?.promptTokens;
    const rawOutput = usage?.outputTokens ?? usage?.completionTokens;
    const rawTotal = usage?.totalTokens;
    const reasoningTokens = usage?.reasoningTokens ?? 0;
    const cacheCreation = getCacheCreationTtlInputTokens(result);
    const cacheReadInputTokens = getCacheReadInputTokens(result);
    const rawUsage = getRawAnthropicUsage(result);
    const hasUsage =
      typeof rawInput === "number" && typeof rawOutput === "number";

    if (!hasUsage) {
      bucket.missingUsageCallCount += 1;
      logger.warn(
        { event: "cost.usage_missing", stage, modelId: reportedModelId },
        "LLM result missing usage data — recording zero tokens",
      );
      this.stages.set(stage, bucket);
      return;
    }

    bucket.inputTokens += rawInput;
    bucket.outputTokens += rawOutput;
    bucket.totalTokens += typeof rawTotal === "number" ? rawTotal : rawInput + rawOutput;
    bucket.reasoningTokens += reasoningTokens;
    bucket.cacheCreationInputTokens += cacheCreation.aggregate;
    bucket.cacheCreation5mInputTokens += cacheCreation.fiveMinute;
    bucket.cacheCreation1hInputTokens += cacheCreation.oneHour;
    bucket.cacheReadInputTokens += cacheReadInputTokens;
    if (rawUsage) {
      bucket.rawUsage = [...bucket.rawUsage, rawUsage];
    }

    const {
      usdCost,
      inputUsdCost,
      outputUsdCost,
      cacheCreationInputUsdCost,
      cacheCreation5mInputUsdCost,
      cacheCreation1hInputUsdCost,
      cacheReadInputUsdCost,
      unknownModel,
    } = computeUsdCost({
      modelId: reportedModelId,
      inputTokens: rawInput,
      outputTokens: rawOutput,
      cacheCreationInputTokens: cacheCreation.aggregate,
      cacheCreation5mInputTokens: cacheCreation.fiveMinute,
      cacheCreation1hInputTokens: cacheCreation.oneHour,
      cacheReadInputTokens,
    });
    if (unknownModel) {
      bucket.unknownModelCallCount += 1;
      logger.warn(
        {
          event: "cost.unknown_model",
          stage,
          modelId: reportedModelId,
          requestedModelId: fallbackModelId,
        },
        "unknown model id — recording zero USD cost",
      );
    }
    bucket.usdCost += usdCost;
    bucket.inputUsdCost += inputUsdCost;
    bucket.outputUsdCost += outputUsdCost;
    bucket.cacheCreationInputUsdCost += cacheCreationInputUsdCost;
    bucket.cacheCreation5mInputUsdCost += cacheCreation5mInputUsdCost;
    bucket.cacheCreation1hInputUsdCost += cacheCreation1hInputUsdCost;
    bucket.cacheReadInputUsdCost += cacheReadInputUsdCost;
    this.stages.set(stage, bucket);
  }

  snapshot(): RunCostBreakdown {
    const stages: Partial<Record<LlmStage, StageCost>> = {};
    let totalUsdCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalReasoningTokens = 0;
    let totalCacheCreationInputTokens = 0;
    let totalCacheCreation5mInputTokens = 0;
    let totalCacheCreation1hInputTokens = 0;
    let totalCacheReadInputTokens = 0;
    let totalInputUsdCost = 0;
    let totalOutputUsdCost = 0;
    let totalCacheCreationInputUsdCost = 0;
    let totalCacheCreation5mInputUsdCost = 0;
    let totalCacheCreation1hInputUsdCost = 0;
    let totalCacheReadInputUsdCost = 0;
    for (const [stage, mutable] of this.stages) {
      stages[stage] = toStageCost(mutable);
      totalUsdCost += mutable.usdCost;
      totalInputTokens += mutable.inputTokens;
      totalOutputTokens += mutable.outputTokens;
      totalTokens += mutable.totalTokens;
      totalReasoningTokens += mutable.reasoningTokens;
      totalCacheCreationInputTokens += mutable.cacheCreationInputTokens;
      totalCacheCreation5mInputTokens += mutable.cacheCreation5mInputTokens;
      totalCacheCreation1hInputTokens += mutable.cacheCreation1hInputTokens;
      totalCacheReadInputTokens += mutable.cacheReadInputTokens;
      totalInputUsdCost += mutable.inputUsdCost;
      totalOutputUsdCost += mutable.outputUsdCost;
      totalCacheCreationInputUsdCost += mutable.cacheCreationInputUsdCost;
      totalCacheCreation5mInputUsdCost += mutable.cacheCreation5mInputUsdCost;
      totalCacheCreation1hInputUsdCost += mutable.cacheCreation1hInputUsdCost;
      totalCacheReadInputUsdCost += mutable.cacheReadInputUsdCost;
    }
    return {
      stages,
      totalUsdCost: Math.round(totalUsdCost * 1_000_000) / 1_000_000,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalReasoningTokens,
      totalCacheCreationInputTokens,
      totalCacheCreation5mInputTokens,
      totalCacheCreation1hInputTokens,
      totalCacheReadInputTokens,
      totalInputUsdCost: Math.round(totalInputUsdCost * 1_000_000) / 1_000_000,
      totalOutputUsdCost:
        Math.round(totalOutputUsdCost * 1_000_000) / 1_000_000,
      totalCacheCreationInputUsdCost:
        Math.round(totalCacheCreationInputUsdCost * 1_000_000) / 1_000_000,
      totalCacheCreation5mInputUsdCost:
        Math.round(totalCacheCreation5mInputUsdCost * 1_000_000) / 1_000_000,
      totalCacheCreation1hInputUsdCost:
        Math.round(totalCacheCreation1hInputUsdCost * 1_000_000) / 1_000_000,
      totalCacheReadInputUsdCost:
        Math.round(totalCacheReadInputUsdCost * 1_000_000) / 1_000_000,
      capturedAt: new Date().toISOString(),
    };
  }

  hasAnyData(): boolean {
    return this.stages.size > 0;
  }
}
