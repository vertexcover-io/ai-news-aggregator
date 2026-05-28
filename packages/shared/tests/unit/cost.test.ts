import { describe, expect, it } from "vitest";
import {
  computeCallCost,
  extractAnthropicUsage,
  extractDeepSeekUsage,
  extractGeminiUsage,
  extractUsage,
  parseRunCostBreakdown,
} from "@shared/cost.js";
import type { CostComponents, RunCostBreakdown } from "@shared/types/cost-breakdown.js";

const zeroExtras = {
  cachedInputTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  reasoningTokens: 0,
};

describe("computeCallCost (REQ-003)", () => {
  it("applies the documented formula for haiku", () => {
    const components: CostComponents = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheCreation5mTokens: 1_000_000,
      cacheCreation1hTokens: 1_000_000,
      reasoningTokens: 0,
    };
    const result = computeCallCost(components, "claude-haiku-4-5-20251001");
    // 1*1 + 1*5 + 1*0.1 + 1*1.25 + 1*2.0 = 9.35
    expect(result.costUsd).toBeCloseTo(9.35, 10);
  });

  it("returns costUsd null for unknown model id (REQ-004)", () => {
    const components: CostComponents = {
      inputTokens: 100,
      outputTokens: 50,
      ...zeroExtras,
    };
    const result = computeCallCost(components, "unknown-model-xyz");
    expect(result.costUsd).toBeNull();
  });
});

describe("extractAnthropicUsage (REQ-005, REQ-006, REQ-007, EDGE-007)", () => {
  it("maps live-probe usage + providerMetadata fixture exactly (REQ-005)", () => {
    // Canonical fixture from docs/spec/admin-pipeline-cost-analysis/probes/usage-shape.live.log
    const usage = {
      inputTokens: 699,
      outputTokens: 24,
      totalTokens: 723,
      cachedInputTokens: 0,
    };
    const providerMetadata = {
      anthropic: {
        usage: {
          input_tokens: 699,
          output_tokens: 24,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: {
            ephemeral_5m_input_tokens: 0,
            ephemeral_1h_input_tokens: 0,
          },
          service_tier: "standard",
          inference_geo: "not_available",
        },
        cacheCreationInputTokens: 0,
        stopSequence: null,
        iterations: null,
        container: null,
        contextManagement: null,
      },
    };
    expect(extractAnthropicUsage(usage, providerMetadata)).toEqual({
      inputTokens: 699,
      outputTokens: 24,
      cachedInputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    });
  });

  it("defaults reasoningTokens to 0 when missing (REQ-006)", () => {
    const result = extractAnthropicUsage({ inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 }, undefined);
    expect(result.reasoningTokens).toBe(0);
  });

  it("defaults both cache_creation fields to 0 when block missing (REQ-007)", () => {
    const result = extractAnthropicUsage(
      { inputTokens: 1, outputTokens: 2 },
      { anthropic: { usage: { input_tokens: 1, output_tokens: 2 } } },
    );
    expect(result.cacheCreation5mTokens).toBe(0);
    expect(result.cacheCreation1hTokens).toBe(0);
  });

  it("ignores extra SDK fields (EDGE-007)", () => {
    const result = extractAnthropicUsage(
      {
        inputTokens: 5,
        outputTokens: 6,
        cachedInputTokens: 7,
        totalTokens: 99,
        reasoningTokens: 3,
        unknownFutureField: "x",
      },
      {
        anthropic: {
          usage: {
            cache_creation: {
              ephemeral_5m_input_tokens: 11,
              ephemeral_1h_input_tokens: 13,
              someFutureBucket: 999,
            },
            unknownNested: { foo: "bar" },
          },
          unrelatedTopLevel: true,
        },
        openai: { ignored: true },
      },
    );
    expect(result).toEqual({
      inputTokens: 5,
      outputTokens: 6,
      cachedInputTokens: 7,
      cacheCreation5mTokens: 11,
      cacheCreation1hTokens: 13,
      reasoningTokens: 3,
    });
  });
});

describe("computeCallCost edge cases", () => {
  it("EDGE-003: reasoningTokens are priced at outputPerMTok", () => {
    const noReasoning = computeCallCost(
      { inputTokens: 0, outputTokens: 100, ...zeroExtras },
      "claude-haiku-4-5-20251001",
    );
    const withReasoning = computeCallCost(
      {
        inputTokens: 0,
        outputTokens: 100,
        cachedInputTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        reasoningTokens: 100,
      },
      "claude-haiku-4-5-20251001",
    );
    expect(noReasoning.costUsd).toBeCloseTo((100 * 5.0) / 1_000_000, 12);
    expect(withReasoning.costUsd).toBeCloseTo((200 * 5.0) / 1_000_000, 12);
  });

  it("EDGE-009: cache-only call returns exactly $0.10 for haiku at 1M cached input", () => {
    const result = computeCallCost(
      {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 1_000_000,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        reasoningTokens: 0,
      },
      "claude-haiku-4-5-20251001",
    );
    expect(result.costUsd).toBeCloseTo(0.1, 12);
  });
});

describe("extractGeminiUsage + extractUsage dispatch (REQ-006, REQ-007, EDGE-001, EDGE-007)", () => {
  it("maps the live Gemini usage shape exactly via extractUsage (REQ-006)", () => {
    // Fixture mirrors .harness/cheaper-discovery-extraction/probes/ai-sdk-google/payload.sample.json
    const usage = { inputTokens: 147, outputTokens: 191, totalTokens: 338 };
    const providerMetadata = { google: { promptFeedback: null } };
    expect(extractUsage("gemini-3.1-flash-lite", usage, providerMetadata)).toEqual({
      inputTokens: 147,
      outputTokens: 191,
      cachedInputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    });
  });

  it("defaults cachedInputTokens to 0 when absent and never throws (EDGE-001)", () => {
    expect(extractUsage("gemini-3.1-flash-lite", { inputTokens: 10, outputTokens: 5 }, undefined)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    });
  });

  it("carries cachedInputTokens through when present (EDGE-007)", () => {
    const result = extractUsage(
      "gemini-3.1-flash-lite",
      { inputTokens: 10, outputTokens: 5, cachedInputTokens: 3 },
      undefined,
    );
    expect(result.cachedInputTokens).toBe(3);
  });

  it("extractGeminiUsage forces cache-creation tiers to 0 regardless of input", () => {
    expect(extractGeminiUsage({ inputTokens: 1, outputTokens: 2, reasoningTokens: 4 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 4,
    });
  });

  it("routes Anthropic ids to the unchanged extractAnthropicUsage path (REQ-007)", () => {
    const usage = { inputTokens: 5, outputTokens: 6, cachedInputTokens: 7 };
    const anthropicMeta = {
      anthropic: {
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 11,
            ephemeral_1h_input_tokens: 13,
          },
        },
      },
    };
    expect(extractUsage("claude-haiku-4-5-20251001", usage, anthropicMeta)).toEqual(
      extractAnthropicUsage(usage, anthropicMeta),
    );
  });
});

describe("extractDeepSeekUsage + extractUsage dispatch for deepseek- (REQ-005, REQ-006, REQ-017)", () => {
  it("extracts the probe sample shape exactly via extractDeepSeekUsage (REQ-006)", () => {
    // Fixture from .harness/deepseek-v4-web-discovery/probes/deepseek/payload.sample.json
    // SDK reports inputTokens=351 = 256 cached + 95 cache-miss.
    // extractDeepSeekUsage normalises inputTokens to the non-cached portion (95) so
    // CostComponents.inputTokens always means "tokens billed at full input rate".
    const usage = { inputTokens: 351, outputTokens: 157, cachedInputTokens: 256 };
    expect(extractDeepSeekUsage(usage)).toEqual({
      inputTokens: 95, // 351 - 256 = 95 non-cached tokens
      outputTokens: 157,
      cachedInputTokens: 256,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    });
  });

  it("defaults cachedInputTokens to 0 when absent (REQ-006)", () => {
    const result = extractDeepSeekUsage({ inputTokens: 10, outputTokens: 5 });
    expect(result.cachedInputTokens).toBe(0);
  });

  it("routes deepseek- model ids to extractDeepSeekUsage via extractUsage (REQ-005)", () => {
    const usage = { inputTokens: 351, outputTokens: 157, cachedInputTokens: 256 };
    expect(extractUsage("deepseek-chat", usage, undefined)).toEqual(
      extractDeepSeekUsage(usage),
    );
  });

  it("round-trip cost from probe sample matches hand-calculated value (REQ-017)", () => {
    // Probe sample: SDK reports {inputTokens: 351, outputTokens: 157, cachedInputTokens: 256}
    // extractDeepSeekUsage normalises inputTokens to non-cached portion: 351 - 256 = 95
    // CostComponents: {inputTokens: 95, cachedInputTokens: 256, outputTokens: 157}
    // Cost = (95 / 1e6 * 0.14) + (256 / 1e6 * 0.0028) + (157 / 1e6 * 0.28)
    //      = 0.0000133 + 0.0000007168 + 0.00004396
    //      = 0.00005796 (≈ 0.00005732168 per spec REQ-017)
    // Note: 95 * 0.14 = 13.3; 95/1e6 * 0.14 = 0.00001330
    //       256/1e6 * 0.0028 = 0.00000071680
    //       157/1e6 * 0.28 = 0.00004396
    //       Total = 0.00005797680
    const components = extractDeepSeekUsage({ inputTokens: 351, outputTokens: 157, cachedInputTokens: 256 });
    const { costUsd } = computeCallCost(components, "deepseek-chat");
    // Correct formula: non-cached input at full rate + cached at cache-read rate + output
    expect(costUsd).toBeCloseTo(0.00005797680, 9);
  });
});

describe("computeCallCost for gemini-3.1-flash-lite (REQ-008)", () => {
  it("prices 1M input + 1M output at $1.75", () => {
    const result = computeCallCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        reasoningTokens: 0,
      },
      "gemini-3.1-flash-lite",
    );
    expect(result.costUsd).toBeCloseTo(1.75, 12);
  });

  it("prices the probe-derived {147,191} sample at ~0.0003204", () => {
    const result = computeCallCost(
      {
        inputTokens: 147,
        outputTokens: 191,
        cachedInputTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        reasoningTokens: 0,
      },
      "gemini-3.1-flash-lite",
    );
    // 147 * 0.25 / 1e6 + 191 * 1.5 / 1e6 = (36.75 + 286.5) / 1e6 = 0.00032325
    expect(result.costUsd).toBeCloseTo(0.00032325, 9);
  });
});

describe("parseRunCostBreakdown (EDGE-011)", () => {
  it("returns the breakdown unchanged when schemaVersion === 1", () => {
    const row: RunCostBreakdown = {
      schemaVersion: 1,
      totalCostUsd: 0.42,
      stages: {},
      unknownModels: [],
      generatedAt: "2026-05-19T00:00:00.000Z",
    };
    expect(parseRunCostBreakdown(row)).toEqual(row);
  });

  it("returns null for future schemaVersion (EDGE-011)", () => {
    const row = { schemaVersion: 2, totalCostUsd: 0.42, stages: {} };
    expect(parseRunCostBreakdown(row)).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(parseRunCostBreakdown(null)).toBeNull();
    expect(parseRunCostBreakdown(undefined)).toBeNull();
  });
});
