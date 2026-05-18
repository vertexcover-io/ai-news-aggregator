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
    promptTokens?: number | null;
    completionTokens?: number | null;
  };
  response?: {
    modelId?: string;
  };
}

interface MutableStage {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  usdCost: number;
  model: string;
  missingUsageCallCount: number;
  unknownModelCallCount: number;
}

function emptyStage(): MutableStage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    callCount: 0,
    usdCost: 0,
    model: "",
    missingUsageCallCount: 0,
    unknownModelCallCount: 0,
  };
}

function toStageCost(s: MutableStage): StageCost {
  const out: StageCost = {
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    callCount: s.callCount,
    usdCost: Math.round(s.usdCost * 1_000_000) / 1_000_000,
    model: s.model,
  };
  if (s.missingUsageCallCount > 0) {
    out.missingUsageCallCount = s.missingUsageCallCount;
  }
  if (s.unknownModelCallCount > 0) {
    out.unknownModelCallCount = s.unknownModelCallCount;
  }
  return out;
}

export class RunCostAccumulator {
  private readonly stages = new Map<LlmStage, MutableStage>();

  record(
    stage: LlmStage,
    result: LlmCallResult,
    fallbackModelId: string,
  ): void {
    const bucket = this.stages.get(stage) ?? emptyStage();

    const modelId = result.response?.modelId ?? fallbackModelId;
    bucket.model = modelId;
    bucket.callCount += 1;

    const usage = result.usage;
    const rawInput = usage?.inputTokens ?? usage?.promptTokens;
    const rawOutput = usage?.outputTokens ?? usage?.completionTokens;
    const hasUsage =
      typeof rawInput === "number" && typeof rawOutput === "number";

    if (!hasUsage) {
      bucket.missingUsageCallCount += 1;
      logger.warn(
        { event: "cost.usage_missing", stage, modelId },
        "LLM result missing usage data — recording zero tokens",
      );
      this.stages.set(stage, bucket);
      return;
    }

    bucket.inputTokens += rawInput;
    bucket.outputTokens += rawOutput;

    const { usdCost, unknownModel } = computeUsdCost(
      modelId,
      rawInput,
      rawOutput,
    );
    if (unknownModel) {
      bucket.unknownModelCallCount += 1;
      logger.warn(
        { event: "cost.unknown_model", stage, modelId },
        "unknown model id — recording zero USD cost",
      );
    }
    bucket.usdCost += usdCost;
    this.stages.set(stage, bucket);
  }

  snapshot(): RunCostBreakdown {
    const stages: Partial<Record<LlmStage, StageCost>> = {};
    let totalUsdCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const [stage, mutable] of this.stages) {
      stages[stage] = toStageCost(mutable);
      totalUsdCost += mutable.usdCost;
      totalInputTokens += mutable.inputTokens;
      totalOutputTokens += mutable.outputTokens;
    }
    return {
      stages,
      totalUsdCost: Math.round(totalUsdCost * 1_000_000) / 1_000_000,
      totalInputTokens,
      totalOutputTokens,
      capturedAt: new Date().toISOString(),
    };
  }

  hasAnyData(): boolean {
    return this.stages.size > 0;
  }
}
