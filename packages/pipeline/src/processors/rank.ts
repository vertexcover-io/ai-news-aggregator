import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import type { RankedItemRef, SourceType } from "@newsletter/shared";
const logger = createLogger("processor:rank");

export const rankSystemPrompt = `You rank news items for a curious technical professional who wants to stay
informed without wasting time on fluff.

Score each item 0–100 on overall value to this reader, judged on three axes:

1. Novelty — new information, findings, releases, or perspectives. Recaps,
   reposts, and rehashed takes score low.
2. Signal vs hype — substantive content with real detail or primary-source
   authority. Marketing, PR, funding announcements, rebrands, and thin
   launches score low.
3. Actionability — the reader learns or can do something concrete. Gossip,
   drama, and pure entertainment score low.

Score anchors:
- 80–100: strong on all three axes; a reader would thank you for surfacing it.
- 60–79: solid on two axes; worth reading.
- 40–59: mixed; one clear strength, notable weaknesses.
- 20–39: weak overall; mostly noise with a faint signal.
- 0–19: fluff, PR, listicle, or off-topic.

Engagement rules (strict):
- The \`engagement\` field (points, comments) is context only. High engagement
  does NOT raise the score. Low or zero engagement does NOT lower it.
  A viral PR post still scores low. A quiet primary source can score high.
- Judge the content itself, inferred from the title, url, sourceType, and
  publishedAt.

Output:
- Return every candidate, ranked by score descending.
- Each rationale is one line and must name the driving axis, e.g.
  "strong novelty — first public benchmark of X" or
  "low signal — funding announcement, no technical substance".
- Use the \`id\` field verbatim.
`;

const DEFAULT_MODEL = "gemini-2.5-flash";
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
      model: google(modelId),
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
