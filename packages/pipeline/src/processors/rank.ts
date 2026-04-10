import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import type { RankedItemRef, SourceType } from "@newsletter/shared";
const logger = createLogger("processor:rank");

export const rankSystemPrompt = `You rank AI news items for a technical audience (ML engineers, infra engineers,
researchers building LLM applications). Score each candidate 0–100 on:

- **Technical novelty** — new results, architectures, benchmarks, tools.
- **Practical value** — concrete for engineers shipping AI systems.
- **Signal vs noise** — penalize PR, funding news, recaps, listicles.

Return a ranked array with a one-line rationale per item. Include every
candidate you consider relevant (score > 30). Lower scores for recaps, fluff,
or marketing. Use the \`id\` field from the input verbatim.
`;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_CANDIDATES = 100;

export interface RankCandidate {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  publishedAt: string | null;
  engagement: { points: number; commentCount: number };
}

export interface RankResult {
  rankedItems: RankedItemRef[];
  candidateCount: number;
  rankedCount: number;
}

export interface RankOptions {
  topN: number;
  modelId?: string;
  runId?: string;
}

const rankedEntrySchema = z.object({
  id: z.number().int(),
  score: z.number(),
  rationale: z.string().min(1),
});

export const rankedResponseSchema = z.object({
  ranked: z.array(rankedEntrySchema),
});

function engagementOf(c: RankCandidate): number {
  return c.engagement.points + c.engagement.commentCount;
}

function capCandidates(items: RankCandidate[]): RankCandidate[] {
  if (items.length <= MAX_CANDIDATES) return items;
  return [...items]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, MAX_CANDIDATES);
}

export async function rankCandidates(
  candidates: RankCandidate[],
  options: RankOptions,
  generate: typeof generateObject = generateObject,
): Promise<RankResult> {
  if (candidates.length === 0) {
    return { rankedItems: [], candidateCount: 0, rankedCount: 0 };
  }

  const capped = capCandidates(candidates);
  const modelId =
    options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  const userPayload = capped.map((c) => ({
    id: c.id,
    title: c.title,
    url: c.url,
    sourceType: c.sourceType,
    publishedAt: c.publishedAt,
    engagement: c.engagement,
  }));

  let result: { object: z.infer<typeof rankedResponseSchema> };
  try {
    result = (await generate({
      model: anthropic(modelId),
      system: rankSystemPrompt,
      prompt: JSON.stringify({ candidates: userPayload }),
      schema: rankedResponseSchema,
    })) as { object: z.infer<typeof rankedResponseSchema> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "run.rank.failed", error: message },
      "run.rank.failed",
    );
    throw new Error(`ranking failed: ${message}`, { cause: err });
  }

  const validIds = new Set(capped.map((c) => c.id));
  const valid = result.object.ranked.filter((r) => validIds.has(r.id));
  if (valid.length === 0) {
    throw new Error("ranking returned no valid items");
  }

  const sorted = [...valid]
    .sort((a, b) => b.score - a.score)
    .slice(0, options.topN);

  const rankedItems: RankedItemRef[] = sorted.map((r) => ({
    rawItemId: r.id,
    score: r.score,
    rationale: r.rationale,
  }));

  logger.info(
    {
      event: "run.rank",
      runId: options.runId,
      candidateCount: capped.length,
      rankedCount: rankedItems.length,
    },
    "run.rank",
  );

  return {
    rankedItems,
    candidateCount: capped.length,
    rankedCount: rankedItems.length,
  };
}
