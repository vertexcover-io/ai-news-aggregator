import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import type {
  Candidate,
  RankedItemRef,
  UserProfile,
  RawItemComment,
} from "@newsletter/shared";
import {
  RANK_SYSTEM_PROMPT_NO_PROFILE,
  composeProfiledPrompt,
} from "@pipeline/processors/rank-prompts.js";
import { loadBodiesForShortlist as defaultLoadBodies } from "@pipeline/processors/rank-body-loader.js";
import {
  recencyGravity,
  ageHoursFromPublishedAt,
} from "@pipeline/services/recency.js";

const logger = createLogger("processor:rank");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BODY_TOKEN_BUDGET = 2000;
const DEFAULT_COMMENTS_PER_ITEM = 5;
const DEFAULT_COMMENT_TOKEN_BUDGET = 200;

// Authority weights (REQ-019)
export const AUTHORITY_WEIGHTS: Record<string, number> = {
  blog: 1.0,
  reddit: 0.85,
  hn: 0.75,
};

// Engagement normalisation maxima (REQ-018)
export const ENGAGEMENT_SOURCE_MAX: Record<string, number> = {
  hn: 2000,
  reddit: 10000,
  blog: 0,
};

export function normalizeEngagement(candidate: Candidate): number {
  const sourceMax = ENGAGEMENT_SOURCE_MAX[candidate.sourceType] ?? 0;
  if (sourceMax === 0) return 0;
  const merged = candidate.engagement.points + candidate.engagement.commentCount;
  const norm = Math.log(1 + merged) / Math.log(1 + sourceMax);
  return Math.min(1, norm);
}

export interface RankOptions {
  profile: UserProfile | null;
  topN: number;
  bodyTokenBudget?: number;
  commentsPerItem?: number;
  commentTokenBudget?: number;
  modelId?: string;
  runId?: string;
  generateObject?: typeof defaultGenerateObject;
  loadBodies?: typeof defaultLoadBodies;
  now?: Date;
}

export interface RankResult {
  rankedItems: RankedItemRef[];
  candidateCount: number;
  rankedCount: number;
}

const axisSchema = z.number().int().min(1).max(5);

const profiledEntrySchema = z.object({
  id: z.number().int(),
  relevance: axisSchema,
  novelty: axisSchema,
  signalVsHype: axisSchema,
  actionability: axisSchema,
  rationale: z.string().min(1),
});

const noProfileEntrySchema = z.object({
  id: z.number().int(),
  novelty: axisSchema,
  signalVsHype: axisSchema,
  actionability: axisSchema,
  rationale: z.string().min(1),
});

const profiledResponseSchema = z.object({ ranked: z.array(profiledEntrySchema) });
const noProfileResponseSchema = z.object({ ranked: z.array(noProfileEntrySchema) });

const PROFILED_AXES = [
  "Relevance",
  "Novelty",
  "Signal-vs-hype",
  "Actionability",
] as const;
const NO_PROFILE_AXES = ["Novelty", "Signal-vs-hype", "Actionability"] as const;

const PROFILED_WEIGHTS = { llm: 0.40, engagement: 0.25, recency: 0.20, authority: 0.15 };
const NO_PROFILE_WEIGHTS = { llm: 0.50, engagement: 0.30, recency: 0.20 };

// Approximate token count as ceil(chars / 4).
function truncateByTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * 4;
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget);
}

function humanAge(ageHours: number): string {
  if (ageHours < 1) return `${Math.round(ageHours * 60)}m ago`;
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

interface PromptItem {
  id: number;
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string | null;
  ageHuman: string;
  body: string | null;
  comments?: string[];
}

function buildPromptItem(
  candidate: Candidate,
  body: string | null,
  now: Date,
  bodyTokenBudget: number,
  commentsPerItem: number,
  commentTokenBudget: number,
): PromptItem {
  const ageHours = ageHoursFromPublishedAt(candidate.publishedAt, now);
  const truncatedBody =
    body === null ? null : truncateByTokenBudget(body, bodyTokenBudget);

  const item: PromptItem = {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    sourceType: candidate.sourceType,
    publishedAt: candidate.publishedAt
      ? candidate.publishedAt.toISOString()
      : null,
    ageHuman: humanAge(ageHours),
    body: truncatedBody,
  };

  if (candidate.comments.length > 0) {
    const topComments = candidate.comments.slice(0, commentsPerItem);
    item.comments = topComments.map((c: RawItemComment) =>
      truncateByTokenBudget(c.content, commentTokenBudget),
    );
  }

  return item;
}

type ProfiledEntry = z.infer<typeof profiledEntrySchema>;
type NoProfileEntry = z.infer<typeof noProfileEntrySchema>;

interface ScoredEntry {
  rawItemId: number;
  meanAxis: number;
  rationale: string;
  candidate: Candidate;
}

function applyQualityGate(entries: ScoredEntry[]): ScoredEntry[] {
  const passing = entries.filter((e) => e.meanAxis >= 2.0);
  if (passing.length > 0) return passing;
  const best = entries.reduce((a, b) => (b.meanAxis > a.meanAxis ? b : a));
  return [best];
}

export async function rankCandidates(
  shortlist: Candidate[],
  options: RankOptions,
): Promise<RankResult> {
  const started = Date.now();

  if (shortlist.length === 0) {
    return { rankedItems: [], candidateCount: 0, rankedCount: 0 };
  }

  const generate = options.generateObject ?? defaultGenerateObject;
  const loadBodies = options.loadBodies ?? defaultLoadBodies;
  const now = options.now ?? new Date();
  const bodyTokenBudget = options.bodyTokenBudget ?? DEFAULT_BODY_TOKEN_BUDGET;
  const commentsPerItem = options.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;
  const commentTokenBudget =
    options.commentTokenBudget ?? DEFAULT_COMMENT_TOKEN_BUDGET;
  const modelId =
    options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  const bodies = await loadBodies(shortlist);

  const promptItems = shortlist.map((c) =>
    buildPromptItem(
      c,
      bodies.get(c.id) ?? null,
      now,
      bodyTokenBudget,
      commentsPerItem,
      commentTokenBudget,
    ),
  );

  const systemPrompt =
    options.profile !== null
      ? composeProfiledPrompt(options.profile)
      : RANK_SYSTEM_PROMPT_NO_PROFILE;

  const axes = options.profile !== null ? PROFILED_AXES : NO_PROFILE_AXES;
  const schema = options.profile !== null ? profiledResponseSchema : noProfileResponseSchema;

  let ranked: (ProfiledEntry | NoProfileEntry)[];
  try {
    const res = (await generate({
      model: anthropic(modelId),
      system: systemPrompt,
      prompt: JSON.stringify({ items: promptItems }, null, 2),
      schema,
      temperature: 0,
    })) as { object: { ranked: (ProfiledEntry | NoProfileEntry)[] } };
    ranked = res.object.ranked;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "run.rank.failed", runId: options.runId, error: message },
      "run.rank.failed",
    );
    throw new Error(`ranking failed: ${message}`, { cause: err });
  }

  for (const entry of ranked) {
    const rationaleLower = entry.rationale.toLowerCase();
    const mentionsAxis = axes.some((axis) =>
      rationaleLower.includes(axis.toLowerCase()),
    );
    if (!mentionsAxis) {
      throw new Error(
        `rationale for id=${entry.id} does not name a scoring axis: "${entry.rationale}"`,
      );
    }
  }

  const byId = new Map(shortlist.map((c) => [c.id, c]));
  const validEntries = ranked.filter((r) => byId.has(r.id));
  if (validEntries.length === 0) {
    throw new Error("ranking returned no valid items");
  }

  const scored: ScoredEntry[] = validEntries.flatMap((r) => {
    const cand = byId.get(r.id);
    if (cand === undefined) return [];
    const meanAxis =
      "relevance" in r
        ? (r.relevance + r.novelty + r.signalVsHype + r.actionability) / 4
        : (r.novelty + r.signalVsHype + r.actionability) / 3;
    return [{ rawItemId: r.id, meanAxis, rationale: r.rationale, candidate: cand }];
  });

  const passing = applyQualityGate(scored);

  const adjusted = passing.map((entry) => {
    const cand = entry.candidate;
    const llmSignal = entry.meanAxis / 5;
    const engagementSignal = normalizeEngagement(cand);
    const ageHours = ageHoursFromPublishedAt(cand.publishedAt, now);
    const recencySignal = recencyGravity(ageHours);
    const authoritySignal = AUTHORITY_WEIGHTS[cand.sourceType] ?? 0.75;

    const fusionScore =
      options.profile !== null
        ? PROFILED_WEIGHTS.llm * llmSignal +
          PROFILED_WEIGHTS.engagement * engagementSignal +
          PROFILED_WEIGHTS.recency * recencySignal +
          PROFILED_WEIGHTS.authority * authoritySignal
        : NO_PROFILE_WEIGHTS.llm * llmSignal +
          NO_PROFILE_WEIGHTS.engagement * engagementSignal +
          NO_PROFILE_WEIGHTS.recency * recencySignal;

    return {
      rawItemId: entry.rawItemId,
      score: fusionScore,
      rationale: entry.rationale,
    };
  });

  adjusted.sort((a, b) => b.score - a.score);
  const rankedItems: RankedItemRef[] = adjusted.slice(0, options.topN);

  logger.info(
    {
      event: "run.rank",
      runId: options.runId,
      stage: "rank",
      inputCount: shortlist.length,
      outputCount: rankedItems.length,
      durationMs: Date.now() - started,
    },
    "run.rank",
  );

  return {
    rankedItems,
    candidateCount: shortlist.length,
    rankedCount: rankedItems.length,
  };
}
