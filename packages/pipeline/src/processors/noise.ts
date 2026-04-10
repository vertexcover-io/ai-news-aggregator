import type { Candidate } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared";

const logger = createLogger("processor:noise");

export const MIN_ENGAGEMENT: Record<string, number> = {
  hn: 5,
  reddit: 10,
  blog: 0,
};

export const NOISE_PATTERNS: readonly RegExp[] = [
  /^Ask HN:/i,
  /^Tell HN:/i,
  /^Who is hiring\?/i,
  /^Freelancer\? Seeking freelancer\?/i,
  /^Show HN:/i,
  /\bHiring\b/i,
  /\bJob(s)?\b/i,
];

export type MinEngagementConfig = Record<string, number>;

export interface NoiseFilterOptions {
  runId?: string;
  minEngagement?: MinEngagementConfig;
  patterns?: RegExp[];
}

export function filterNoise(
  candidates: readonly Candidate[],
  options: NoiseFilterOptions = {},
): Candidate[] {
  const started = Date.now();
  const patterns = options.patterns ?? NOISE_PATTERNS;
  const minEngagement = options.minEngagement ?? MIN_ENGAGEMENT;

  const result = candidates.filter((c) => {
    const threshold = minEngagement[c.sourceType] ?? 0;
    if (c.engagement.points < threshold) return false;
    if (patterns.some((re) => re.test(c.title))) return false;
    return true;
  });

  logger.info(
    {
      event: "noise.end",
      runId: options.runId,
      inputCount: candidates.length,
      outputCount: result.length,
      durationMs: Date.now() - started,
    },
    "noise filter completed",
  );

  return result;
}
