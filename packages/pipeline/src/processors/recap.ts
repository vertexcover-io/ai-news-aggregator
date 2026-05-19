import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createLogger } from "@newsletter/shared/logger";
import type { RecapContent } from "@newsletter/shared";

const logger = createLogger("processor:recap");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const RECAP_SYSTEM_PROMPT = `You are writing a recap for a single news item.

Produce structured story content for the reader. Each story has three distinct editorial layers. Do not let them repeat each other:
- summary = ORIENT. State what happened. Fact-first. No analysis, no implications, no "why it matters".
- bullets = EXPLAIN. Give exactly 3 specific details that help the reader understand the story: numbers, names, product changes, constraints, evidence, caveats, timeline, or comparisons. Each bullet must add new information not already stated in the summary. No generic analysis phrases like "this signals", "this means", "this highlights", "this underscores", or "marks a shift".
- bottomLine = INTERPRET. Answer "so what?" for developers, AI teams, or the market. This is the only place for strategic meaning or implication.

Before returning, check:
1. If summary and bottomLine could both answer "what happened?", rewrite bottomLine.
2. If a bullet merely rephrases the summary, replace it with a concrete detail.
3. If a bullet says why it matters instead of what detail matters, move that idea to bottomLine or delete it.

- title: A 4-to-7-word neutral newswire headline summarizing this story. Sentence case. Names the actor and the action (subject-verb-object). No clickbait, no questions, no colons-as-title-tropes, no editorial framing words like "quietly", "finally", or "doubles down". Aim for ~50 characters. Examples: "OpenAI ships GPT-5 with native tool use", "Anthropic raises $5B at $60B valuation", "Meta open-sources Llama 4 weights", "Google's Veo 3 lands on Vertex AI".
- summary: One sentence, ≤25 words. Actor + action + object + important number/name if available. No analysis. No markdown links. Good: "OpenAI released GPT-5 today with a 400K-token context window and native tool use." Bad: "OpenAI's release shows the race for agentic tooling is heating up."
- bullets: Exactly 3 short plain-text bullets, ≤15 words each. Each bullet is a concrete detail: metric, feature, date, product name, limitation, evidence, affected user, or comparison. Do not summarize the whole story again. Do not explain "why this matters". No markdown links. Good: "Outperforms GPT-4o by 18% on SWE-bench Verified." Bad: "This could change how developers build with AI."
- bottomLine: One sentence, ≤25 words. Give the strategic takeaway or implication. Must not repeat the summary's fact pattern. No markdown links. Good: "Native tool use makes agent frameworks less about JSON glue and more about reliability, evals, and workflow design." Bad: "OpenAI released GPT-5 with native tool use."
`;

export const recapContentSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  bullets: z.array(z.string()),
  bottomLine: z.string(),
});

export interface RecapInputItem {
  id: number;
  title: string;
  url: string;
  sourceType: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null;
}

export interface GenerateRecapOptions {
  generateObject?: typeof defaultGenerateObject;
  modelId?: string;
}

export async function generateRecap(
  item: RecapInputItem,
  options: GenerateRecapOptions = {},
): Promise<RecapContent> {
  const generate = options.generateObject ?? defaultGenerateObject;
  const modelId = options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  const prompt = JSON.stringify(
    {
      item: {
        id: item.id,
        title: item.title,
        url: item.url,
        sourceType: item.sourceType,
        author: item.author,
        publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
        body: item.content,
      },
    },
    null,
    2,
  );

  try {
    const result = (await generate({
      model: anthropic(modelId),
      system: RECAP_SYSTEM_PROMPT,
      prompt,
      schema: recapContentSchema,
      providerOptions: {
        anthropic: { structuredOutputMode: "outputFormat" },
      },
      temperature: 0,
    })) as { object: RecapContent };
    return result.object;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "recap.generate.failed", itemId: item.id, error: message },
      "recap.generate.failed",
    );
    throw err instanceof Error ? err : new Error(message);
  }
}
