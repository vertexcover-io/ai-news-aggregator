import type { Candidate, UserProfile } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared";
import {
  embedBatch as defaultEmbedBatch,
  cosineSimilarity,
} from "@pipeline/services/embeddings.js";

const logger = createLogger("processor:shortlist");

export const DEFAULT_SHORTLIST_SIZE = 20;
export const DEFAULT_ANTI_TOPIC_WEIGHT = 0.5;

export interface ShortlistOptions {
  profile: UserProfile | null;
  shortlistSize?: number;
  antiTopicWeight?: number;
  runId?: string;
  now?: Date;
  embedBatch?: typeof defaultEmbedBatch;
  titleEmbeds?: number[][]; // pre-computed from semantic-dedup (REQ-009)
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
  titleEmbeds: number[][]; // same order as shortlist — forwarded to MMR (REQ-009)
}

export async function shortlistCandidates(
  candidates: Candidate[],
  options: ShortlistOptions,
): Promise<ShortlistResult> {
  const startedAt = Date.now();
  const shortlistSize = options.shortlistSize ?? DEFAULT_SHORTLIST_SIZE;
  const antiWeight = options.antiTopicWeight ?? DEFAULT_ANTI_TOPIC_WEIGHT;
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
    const empty: ShortlistResult = {
      shortlist: [],
      breakdowns: [],
      titleEmbeds: [],
    };
    logEnd({ candidates, ordered: empty, startedAt, runId: options.runId });
    return empty;
  }

  if (options.profile === null) {
    // No profile: no cosine, no recency — pass all through, stable id order (REQ-011)
    const sorted = [...candidates].sort((a, b) => a.id - b.id);
    const top = sorted.slice(0, shortlistSize);
    const breakdowns: ShortlistBreakdown[] = top.map((c) => ({
      id: c.id,
      relevance: 0,
      recency: 0,
      combined: 0,
    }));
    // titleEmbeds: empty slices; MMR will use Jaccard in no-profile mode
    const titleEmbeds: number[][] = top.map(() => []);
    const ordered: ShortlistResult = { shortlist: top, breakdowns, titleEmbeds };
    logEnd({ candidates, ordered, startedAt, runId: options.runId });
    return ordered;
  }

  const profile = options.profile;
  const antiTopics = profile.antiTopics ?? [];
  const topicInputs = [...profile.topics, ...antiTopics];
  const topicEmbeds = await embed(topicInputs, { inputType: "query" });
  const topicVecs = topicEmbeds.slice(0, profile.topics.length);
  const antiVecs = topicEmbeds.slice(profile.topics.length);

  // REQ-009: reuse pre-computed title embeddings from semantic-dedup if available
  const titleEmbedsFull: number[][] =
    options.titleEmbeds ??
    (await embed(candidates.map((c) => c.title), { inputType: "document" }));

  const breakdowns: ShortlistBreakdown[] = candidates.map((c, i) => {
    const titleVec = titleEmbedsFull[i] ?? [];
    const topicSim = topicVecs.length
      ? Math.max(...topicVecs.map((v) => cosineSimilarity(titleVec, v)))
      : 0;
    const antiSim = antiVecs.length
      ? Math.max(...antiVecs.map((v) => cosineSimilarity(titleVec, v)))
      : 0;
    // REQ-011: combined = relevance only — no recency in shortlist
    const relevance = topicSim - antiWeight * antiSim;
    return { id: c.id, relevance, recency: 0, combined: relevance };
  });

  const result = sortAndTake(candidates, breakdowns, shortlistSize);

  // Build titleEmbeds slice matching the ordered shortlist
  const indexMap = new Map(candidates.map((c, i) => [c.id, i]));
  const resultTitleEmbeds = result.shortlist.map((c) => {
    const idx = indexMap.get(c.id) ?? 0;
    return titleEmbedsFull[idx] ?? [];
  });

  logEnd({
    candidates,
    ordered: { ...result, titleEmbeds: resultTitleEmbeds },
    startedAt,
    runId: options.runId,
  });

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

  return { ...result, titleEmbeds: resultTitleEmbeds };
}

function sortAndTake(
  candidates: Candidate[],
  breakdowns: ShortlistBreakdown[],
  size: number,
): Omit<ShortlistResult, "titleEmbeds"> {
  const withCandidates = candidates.map((c, i) => ({ c, b: breakdowns[i] ?? { id: c.id, relevance: 0, recency: 0, combined: 0 } }));
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
