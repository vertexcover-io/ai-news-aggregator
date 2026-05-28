import { MODEL_PRICING } from "./pricing.js";
import type { CostComponents, RunCostBreakdown } from "./types/cost-breakdown.js";

export interface CallCostResult {
  costUsd: number | null;
}

export function computeCallCost(components: CostComponents, modelId: string): CallCostResult {
  if (!(modelId in MODEL_PRICING)) return { costUsd: null };
  const pricing = MODEL_PRICING[modelId];
  const {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    reasoningTokens,
  } = components;
  const costUsd =
    (inputTokens * pricing.inputPerMTok +
      (outputTokens + reasoningTokens) * pricing.outputPerMTok +
      cachedInputTokens * pricing.cacheReadPerMTok +
      cacheCreation5mTokens * pricing.cacheWrite5mPerMTok +
      cacheCreation1hTokens * pricing.cacheWrite1hPerMTok) /
    1_000_000;
  return { costUsd };
}

interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function extractAnthropicUsage(
  usage: UsageLike | undefined,
  providerMetadata: unknown,
): CostComponents {
  const anthropic = asRecord(asRecord(providerMetadata)?.anthropic);
  const anthropicUsage = asRecord(anthropic?.usage);
  const cacheCreation = asRecord(anthropicUsage?.cache_creation);
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    cacheCreation5mTokens: asNumber(cacheCreation?.ephemeral_5m_input_tokens) ?? 0,
    cacheCreation1hTokens: asNumber(cacheCreation?.ephemeral_1h_input_tokens) ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
  };
}

export function extractGeminiUsage(usage: UsageLike | undefined): CostComponents {
  // Gemini also reports inputTokens as the TOTAL (cached + non-cached). Subtract the cached
  // portion so CostComponents.inputTokens is uniformly "tokens billed at full input rate".
  const totalInput = usage?.inputTokens ?? 0;
  const cached = usage?.cachedInputTokens ?? 0;
  return {
    inputTokens: totalInput - cached,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: cached,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
  };
}

export function extractDeepSeekUsage(usage: UsageLike | undefined): CostComponents {
  // DeepSeek reports inputTokens as the TOTAL (cached + non-cached). Subtract the cached
  // portion so CostComponents.inputTokens is uniformly "tokens billed at full input rate"
  // across all providers, matching the Anthropic convention.
  const totalInput = usage?.inputTokens ?? 0;
  const cached = usage?.cachedInputTokens ?? 0;
  return {
    inputTokens: totalInput - cached,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: cached,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: 0,
  };
}

export function extractUsage(
  modelId: string,
  usage: UsageLike | undefined,
  providerMetadata: unknown,
): CostComponents {
  if (modelId.startsWith("deepseek-")) return extractDeepSeekUsage(usage);
  if (modelId.startsWith("gemini-")) return extractGeminiUsage(usage);
  return extractAnthropicUsage(usage, providerMetadata);
}

export function parseRunCostBreakdown(value: unknown): RunCostBreakdown | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.schemaVersion !== 1) return null;
  const stages = asRecord(record.stages);
  if (!stages) return null;
  const totalCostUsd = record.totalCostUsd;
  if (totalCostUsd !== null && typeof totalCostUsd !== "number") return null;
  const unknownModels = Array.isArray(record.unknownModels)
    ? (record.unknownModels.filter((v): v is string => typeof v === "string"))
    : [];
  const generatedAt = typeof record.generatedAt === "string" ? record.generatedAt : "";
  return {
    schemaVersion: 1,
    totalCostUsd,
    stages: stages as RunCostBreakdown["stages"],
    unknownModels,
    generatedAt,
  };
}
