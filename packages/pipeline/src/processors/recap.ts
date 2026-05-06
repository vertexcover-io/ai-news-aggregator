import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createLogger } from "@newsletter/shared/logger";
import type { RecapContent } from "@newsletter/shared";

const logger = createLogger("processor:recap");

const DEFAULT_MODEL = "claude-sonnet-4-6";

export const RECAP_SYSTEM_PROMPT = `You are writing a recap for a single news item.

Produce a structured recap for the reader:
- summary: A 1-2 sentence plain-text news summary of what happened. No markdown links.
- bullets: 3-5 plain-text analysis points explaining why this matters and what it means. No markdown links.
- bottomLine: A single plain-text strategic takeaway sentence. No markdown links.
`;

export const recapContentSchema = z.object({
  summary: z.string().min(10),
  bullets: z.array(z.string().min(10)).min(3).max(5),
  bottomLine: z.string().min(10),
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
