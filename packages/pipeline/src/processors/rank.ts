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
  ageHoursFromPublishedAt,
  recencyDecay,
  DEFAULT_HALF_LIFE_HOURS,
} from "@pipeline/services/recency.js";
import type { ShortlistBreakdown } from "@pipeline/processors/shortlist.js";

const logger = createLogger("processor:rank");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const RANK_MAX_TOKENS = 16_384; // claude-haiku-4-5 context ceiling
const DEFAULT_BODY_TOKEN_BUDGET = 2000;
const DEFAULT_COMMENTS_PER_ITEM = 5;
const DEFAULT_COMMENT_TOKEN_BUDGET = 200;

export interface RankOptions {
  profile: UserProfile | null;
  topN: number;
  halfLifeHours?: number;
  shortlistBreakdowns?: ShortlistBreakdown[];
  bodyTokenBudget?: number;
  commentsPerItem?: number;
  commentTokenBudget?: number;
  modelId?: string;
  runId?: string;
  generateObject?: typeof defaultGenerateObject;
  loadBodies?: typeof defaultLoadBodies;
  now?: Date;
  abortSignal?: AbortSignal;
}

export interface RankResult {
  rankedItems: RankedItemRef[];
  candidateCount: number;
  rankedCount: number;
}

const rankedEntrySchema = z.object({
  id: z.number().int(),
  score: z.number(),
  rationale: z.string().min(1),
  summary: z.string(),
  bullets: z.array(z.string()).min(1).max(5),
  bottomLine: z.string(),
});

export const rankedResponseSchema = z.object({
  ranked: z.array(rankedEntrySchema),
});

const PROFILED_AXES = [
  "Relevance",
  "Novelty",
  "Signal-vs-hype",
  "Actionability",
] as const;
const NO_PROFILE_AXES = ["Novelty", "Signal-vs-hype", "Actionability"] as const;

// Approximate token count as ceil(chars / 4). This is coarse but good enough
// for a truncation budget; swap in a real tokenizer if precision ever matters.
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
  stage1Score: number | null;
  body: string | null;
  comments?: string[];
}

function buildPromptItem(
  candidate: Candidate,
  body: string | null,
  stage1Score: number | null,
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
    stage1Score,
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
  const halfLifeHours = options.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const bodyTokenBudget = options.bodyTokenBudget ?? DEFAULT_BODY_TOKEN_BUDGET;
  const commentsPerItem = options.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;
  const commentTokenBudget =
    options.commentTokenBudget ?? DEFAULT_COMMENT_TOKEN_BUDGET;
  const modelId =
    options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  const bodies = await loadBodies(shortlist);
  const stage1Scores = new Map<number, number>();
  if (options.shortlistBreakdowns) {
    for (const b of options.shortlistBreakdowns) {
      stage1Scores.set(b.id, b.combined);
    }
  }

  const promptItems = shortlist.map((c) =>
    buildPromptItem(
      c,
      bodies.get(c.id) ?? null,
      stage1Scores.get(c.id) ?? null,
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

  let result: { object: z.infer<typeof rankedResponseSchema> };
  try {
    result = (await generate({
      model: anthropic(modelId),
      system: systemPrompt,
      prompt: JSON.stringify({ items: promptItems }, null, 2),
      schema: rankedResponseSchema,
      temperature: 0,
      maxRetries: 2,
      providerOptions: {
        anthropic: { maxTokens: RANK_MAX_TOKENS },
      },
      abortSignal: options.abortSignal,
    })) as { object: z.infer<typeof rankedResponseSchema> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The AI SDK attaches the raw LLM text to the error as `text` when schema validation fails
    const rawText =
      err !== null &&
      typeof err === "object" &&
      "text" in err &&
      typeof (err as Record<string, unknown>).text === "string"
        ? (err as Record<string, unknown>).text
        : undefined;
    logger.error(
      {
        event: "run.rank.failed",
        runId: options.runId,
        error: message,
        rawLlmResponse: rawText,
      },
      "run.rank.failed",
    );
    throw new Error(`ranking failed: ${message}`, { cause: err });
  }

  for (const entry of result.object.ranked) {
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
  const validEntries = result.object.ranked.filter((r) => byId.has(r.id));
  if (validEntries.length === 0) {
    throw new Error("ranking returned no valid items");
  }

  const adjusted = validEntries.map((r) => {
    const cand = byId.get(r.id);
    const ageHours = ageHoursFromPublishedAt(
      cand?.publishedAt ?? null,
      now,
    );
    const factor = recencyDecay(ageHours, halfLifeHours);
    return {
      rawItemId: r.id,
      score: r.score * factor,
      rationale: r.rationale,
      summary: r.summary,
      bullets: r.bullets,
      bottomLine: r.bottomLine,
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
