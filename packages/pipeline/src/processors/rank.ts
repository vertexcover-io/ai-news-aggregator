import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  createLogger,
  DEFAULT_RANKING_WORKFLOW,
} from "@newsletter/shared";
import type {
  Candidate,
  RankedItemRef,
  RawItemComment,
} from "@newsletter/shared";
import { buildRankSystemPrompt } from "@pipeline/processors/rank-prompts.js";
import { loadBodiesForShortlist as defaultLoadBodies } from "@pipeline/processors/rank-body-loader.js";
import {
  ageHoursFromPublishedAt,
  recencyDecay,
  DEFAULT_HALF_LIFE_HOURS,
} from "@pipeline/services/recency.js";
import type { ShortlistBreakdown } from "@pipeline/processors/shortlist.js";

const logger = createLogger("processor:rank");

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_BODY_TOKEN_BUDGET = 2000;
const DEFAULT_COMMENTS_PER_ITEM = 5;
const DEFAULT_COMMENT_TOKEN_BUDGET = 200;
const RECAP_WORD_BUDGET = 130;

function countWords(text: string): number {
  if (text.length === 0) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface RankOptions {
  topN: number;
  halfLifeHours?: number;
  shortlistBreakdowns?: ShortlistBreakdown[];
  bodyTokenBudget?: number;
  commentsPerItem?: number;
  commentTokenBudget?: number;
  modelId?: string;
  runId?: string;
  rankingWorkflow?: string;
  generateObject?: typeof defaultGenerateObject;
  loadBodies?: typeof defaultLoadBodies;
  now?: Date;
  abortSignal?: AbortSignal;
}

export interface RankResult {
  rankedItems: RankedItemRef[];
  candidateCount: number;
  rankedCount: number;
  digestHeadline: string;
  digestSummary: string;
  hook: string;
}

const rankedEntrySchema = z.object({
  id: z.number(),
  score: z.number(),
  rationale: z.string(),
  title: z.string().min(1),
  summary: z.string(),
  bullets: z.array(z.string()),
  bottomLine: z.string(),
});

const digestSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  hook: z.string(),
});

export const rankedResponseSchema = z.object({
  digest: digestSchema,
  ranked: z.array(rankedEntrySchema),
});

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
    return {
      rankedItems: [],
      candidateCount: 0,
      rankedCount: 0,
      digestHeadline: "",
      digestSummary: "",
      hook: "",
    };
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

  const systemPrompt = buildRankSystemPrompt(
    options.rankingWorkflow ?? DEFAULT_RANKING_WORKFLOW,
  );

  let result: { object: z.infer<typeof rankedResponseSchema> };
  try {
    result = (await generate({
      model: anthropic(modelId),
      system: systemPrompt,
      prompt: JSON.stringify(
        { requestedTopN: options.topN, items: promptItems },
        null,
        2,
      ),
      schema: rankedResponseSchema,
      providerOptions: {
        anthropic: { structuredOutputMode: "outputFormat" },
      },
      temperature: 0,
      maxRetries: 2,
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

  for (const r of result.object.ranked) {
    const bulletsWords = r.bullets.reduce(
      (n, b) => n + countWords(b),
      0,
    );
    const totalWords =
      countWords(r.summary) + bulletsWords + countWords(r.bottomLine);
    if (totalWords > RECAP_WORD_BUDGET) {
      logger.warn(
        {
          event: "rank.recap.over_budget",
          runId: options.runId,
          rawItemId: r.id,
          totalWords,
          bulletCount: r.bullets.length,
          budget: RECAP_WORD_BUDGET,
        },
        "rank.recap.over_budget",
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
      title: r.title,
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
    digestHeadline: result.object.digest.headline,
    digestSummary: result.object.digest.summary,
    hook: result.object.digest.hook,
  };
}
