export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadPerMTok: 0.1,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2.0,
  },
  "claude-sonnet-4-5-20250929": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6.0,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6.0,
  },
  "gemini-3.1-flash-lite": {
    inputPerMTok: 0.25,
    outputPerMTok: 1.5,
    cacheReadPerMTok: 0.025,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
  },
};
