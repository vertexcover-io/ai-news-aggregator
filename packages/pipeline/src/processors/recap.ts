import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createLogger } from "@newsletter/shared/logger";
import type { RecapContent } from "@newsletter/shared";
import type { CostTracker } from "@pipeline/services/cost-tracker.js";
import { RECAP_VOICE_BLOCK } from "@pipeline/processors/rank-prompts.js";

const logger = createLogger("processor:recap");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const RECAP_SYSTEM_PROMPT = `You are writing a recap for a single news item in our editorial voice.

${RECAP_VOICE_BLOCK}
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
  tracker?: CostTracker;
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
    })) as Awaited<ReturnType<typeof defaultGenerateObject>> & {
      object: RecapContent;
    };
    options.tracker?.record({
      stage: "recap",
      modelId,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
    });
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
