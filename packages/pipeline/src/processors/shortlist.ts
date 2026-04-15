import type { Candidate, UserProfile } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared";
import {
  embedBatch as defaultEmbedBatch,
  cosineSimilarity,
} from "@pipeline/services/embeddings.js";
import {
  DEFAULT_HALF_LIFE_HOURS,
  recencyDecay,
  ageHoursFromPublishedAt,
} from "@pipeline/services/recency.js";

const logger = createLogger("processor:shortlist");

export const DEFAULT_SHORTLIST_SIZE = 20;
export const DEFAULT_ANTI_TOPIC_WEIGHT = 0.5;

export interface ShortlistOptions {
  profile: UserProfile | null;
  shortlistSize?: number;
  halfLifeHours?: number;
  antiTopicWeight?: number;
  runId?: string;
  now?: Date;
  embedBatch?: typeof defaultEmbedBatch;
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

export async function shortlistCandidates(
  candidates: Candidate[],
  options: ShortlistOptions,
): Promise<ShortlistResult> {
  const startedAt = Date.now();
  const shortlistSize = options.shortlistSize ?? DEFAULT_SHORTLIST_SIZE;
  const halfLifeHours = options.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const antiWeight = options.antiTopicWeight ?? DEFAULT_ANTI_TOPIC_WEIGHT;
  const now = options.now ?? new Date();
  const embed = options.embedBatch ?? defaultEmbedBatch;

  logger.info(
    {
      event: "shortlist.start",
      runId: options.runId,
      candidateCount: candidates.length,
      shortlistSize,
      profileName: options.profile?.name ?? null,
    },
    "shortlist stage started",
  );

  if (candidates.length === 0) {
    const empty: ShortlistResult = { shortlist: [], breakdowns: [] };
    logEnd({ candidates, ordered: empty, startedAt, runId: options.runId });
    return empty;
  }

  if (options.profile === null) {
    const breakdowns: ShortlistBreakdown[] = candidates.map((c) => {
      const age = ageHoursFromPublishedAt(c.publishedAt, now);
      const recency = recencyDecay(age, halfLifeHours);
      return { id: c.id, relevance: 0, recency, combined: recency };
    });
    const ordered = sortAndTake(candidates, breakdowns, shortlistSize);
    logEnd({ candidates, ordered, startedAt, runId: options.runId });
    return ordered;
  }

  const profile = options.profile;
  const antiTopics = profile.antiTopics ?? [];
  const topicInputs = [...profile.topics, ...antiTopics];
  const topicEmbeds = await embed(topicInputs, { inputType: "query", signal: options.signal });
  const topicVecs = topicEmbeds.slice(0, profile.topics.length);
  const antiVecs = topicEmbeds.slice(profile.topics.length);

  const titleEmbeds = await embed(
    candidates.map((c) => c.title),
    { inputType: "document", signal: options.signal },
  );

  const breakdowns: ShortlistBreakdown[] = candidates.map((c, i) => {
    const titleVec = titleEmbeds[i];
    const topicSim = topicVecs.length
      ? Math.max(...topicVecs.map((v) => cosineSimilarity(titleVec, v)))
      : 0;
    const antiSim = antiVecs.length
      ? Math.max(...antiVecs.map((v) => cosineSimilarity(titleVec, v)))
      : 0;
    const relevance = topicSim - antiWeight * antiSim;
    const age = ageHoursFromPublishedAt(c.publishedAt, now);
    const recency = recencyDecay(age, halfLifeHours);
    return { id: c.id, relevance, recency, combined: relevance * recency };
  });

  const result = sortAndTake(candidates, breakdowns, shortlistSize);
  logEnd({ candidates, ordered: result, startedAt, runId: options.runId });

  if (result.shortlist.length < shortlistSize) {
    logger.warn(
      {
        event: "thin_shortlist",
        runId: options.runId,
        actualSize: result.shortlist.length,
        shortlistSize,
      },
      "shortlist is smaller than requested size",
    );
  }

  const avgRelevance =
    result.breakdowns.reduce((sum, b) => sum + b.relevance, 0) /
    Math.max(1, result.breakdowns.length);
  if (avgRelevance > 0.8) {
    logger.warn(
      { event: "over_broad_profile", runId: options.runId, avgRelevance },
      "profile appears over-broad",
    );
  }

  return result;
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
