import type { Candidate } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared";
import {
  DEFAULT_HALF_LIFE_HOURS,
  recencyDecay,
  ageHoursFromPublishedAt,
  engagementScore,
} from "@pipeline/services/recency.js";

const logger = createLogger("processor:shortlist");

export const DEFAULT_SHORTLIST_SIZE = 30;
export const MIN_SHORTLIST_SIZE = 10;
export const MAX_SHORTLIST_SIZE = 30;
export const DEFAULT_SCORE_FLOOR = 0.15;
export const DEFAULT_ENGAGEMENT_WEIGHT = 0.5;
export const DEFAULT_RECENCY_WEIGHT = 0.5;

export interface ShortlistOptions {
  shortlistSize?: number;
  halfLifeHours?: number;
  engagementWeight?: number;
  recencyWeight?: number;
  scoreFloor?: number;
  runId?: string;
  now?: Date;
  signal?: AbortSignal;
}

export interface ShortlistBreakdown {
  id: number;
  relevance: number;
  recency: number;
  combined: number;
}

export interface ShortlistResult {
  shortlist: Candidate[];
  breakdowns: ShortlistBreakdown[];
}

export function shortlistCandidates(
  candidates: Candidate[],
  options: ShortlistOptions,
): Promise<ShortlistResult> {
  const startedAt = Date.now();
  const shortlistSize = options.shortlistSize ?? DEFAULT_SHORTLIST_SIZE;
  const halfLifeHours = options.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const eWeight = options.engagementWeight ?? DEFAULT_ENGAGEMENT_WEIGHT;
  const rWeight = options.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const scoreFloor = options.scoreFloor ?? DEFAULT_SCORE_FLOOR;
  const now = options.now ?? new Date();

  logger.info(
    {
      event: "shortlist.start",
      runId: options.runId,
      candidateCount: candidates.length,
      shortlistSize,
    },
    "shortlist stage started",
  );

  if (candidates.length === 0) {
    const empty: ShortlistResult = { shortlist: [], breakdowns: [] };
    logEnd({ candidates, ordered: empty, startedAt, runId: options.runId });
    return Promise.resolve(empty);
  }

  const rawEngagements = candidates.map((c) =>
    engagementScore(c.engagement.points, c.engagement.commentCount),
  );
  const maxEngagement = Math.max(...rawEngagements);

  const breakdowns: ShortlistBreakdown[] = candidates.map((c, i) => {
    const age = ageHoursFromPublishedAt(c.publishedAt, now);
    const recency = recencyDecay(age, halfLifeHours);
    const relevance = maxEngagement > 0 ? rawEngagements[i] / maxEngagement : 0;
    const combined = eWeight * relevance + rWeight * recency;
    return { id: c.id, relevance, recency, combined };
  });

  const effectiveSize = dynamicShortlistSize(breakdowns, scoreFloor, shortlistSize);
  const ordered = sortAndTake(candidates, breakdowns, effectiveSize);
  logEnd({ candidates, ordered, startedAt, runId: options.runId });
  return Promise.resolve(ordered);
}

function dynamicShortlistSize(
  breakdowns: ShortlistBreakdown[],
  scoreFloor: number,
  configuredSize: number,
): number {
  const aboveFloor = breakdowns.filter((b) => b.combined >= scoreFloor).length;
  return Math.min(
    MAX_SHORTLIST_SIZE,
    Math.max(MIN_SHORTLIST_SIZE, Math.min(aboveFloor, configuredSize)),
  );
}

function sortAndTake(
  candidates: Candidate[],
  breakdowns: ShortlistBreakdown[],
  size: number,
): ShortlistResult {
  const withCandidates = candidates.map((c, i) => ({ c, b: breakdowns[i] }));
  withCandidates.sort((a, b) => {
    if (a.b.combined !== b.b.combined) return b.b.combined - a.b.combined;
    return a.c.id - b.c.id;
  });
  const top = withCandidates.slice(0, size);
  return {
    shortlist: top.map((x) => x.c),
    breakdowns: top.map((x) => x.b),
  };
}

function logEnd(args: {
  candidates: Candidate[];
  ordered: ShortlistResult;
  startedAt: number;
  runId: string | undefined;
}): void {
  logger.info(
    {
      event: "shortlist.end",
      runId: args.runId,
      stage: "shortlist",
      candidateCount: args.candidates.length,
      inputCount: args.candidates.length,
      outputCount: args.ordered.shortlist.length,
      durationMs: Date.now() - args.startedAt,
    },
    "shortlist stage completed",
  );
  for (const b of args.ordered.breakdowns) {
    logger.debug(
      {
        event: "shortlist.item",
        id: b.id,
        relevance: b.relevance,
        recency: b.recency,
        combined: b.combined,
      },
      "shortlist item breakdown",
    );
  }
}
