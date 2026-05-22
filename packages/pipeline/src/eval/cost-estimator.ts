import { MODEL_PRICING } from "@newsletter/shared";

/**
 * Per-fixture token heuristics for the rerank stage.
 *
 * These are GUESSES based on the typical fixture pool (~20 candidates,
 * 3-axis prompt). Real usage will vary; the estimator exists to flash a
 * ballpark before a `--dry-run` user commits to running --window N.
 */
export const HEURISTIC_INPUT_TOKENS_PER_FIXTURE = 6000;
export const HEURISTIC_OUTPUT_TOKENS_PER_FIXTURE = 3000;

export interface CostEstimate {
  tokensIn: number;
  tokensOut: number;
  usd: number | null;
}

/**
 * Estimate cost for running `fixtureCount` fixtures through `model`.
 *
 * Returns `usd: null` if the model is not in {@link MODEL_PRICING} — callers
 * should treat null as "unknown" and avoid blocking the user on it.
 */
export function estimateCost(fixtureCount: number, model: string): CostEstimate {
  const tokensIn = fixtureCount * HEURISTIC_INPUT_TOKENS_PER_FIXTURE;
  const tokensOut = fixtureCount * HEURISTIC_OUTPUT_TOKENS_PER_FIXTURE;
  if (!(model in MODEL_PRICING)) {
    return { tokensIn, tokensOut, usd: null };
  }
  const pricing = MODEL_PRICING[model];
  const usd =
    (tokensIn / 1_000_000) * pricing.inputPerMTok +
    (tokensOut / 1_000_000) * pricing.outputPerMTok;
  return { tokensIn, tokensOut, usd };
}
