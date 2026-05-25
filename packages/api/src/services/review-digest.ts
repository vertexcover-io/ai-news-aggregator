import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type {
  ReviewDigestContent,
  ReviewDigestItem,
} from "@api/services/review.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface GenerateReviewDigestOptions {
  readonly modelId?: string;
  readonly generateObject?: typeof defaultGenerateObject;
  readonly abortSignal?: AbortSignal;
}

const reviewDigestSchema = z.object({
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

export async function generateReviewDigest(
  items: readonly ReviewDigestItem[],
  options: GenerateReviewDigestOptions = {},
): Promise<ReviewDigestContent> {
  const generate = options.generateObject ?? defaultGenerateObject;
  const modelId = options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;
  const result = await generate({
    model: anthropic(modelId),
    system:
      "You write issue-level editorial copy for an AI newsletter. Generate copy that synthesizes the final reviewed story list. Do not mention stories that are not present in the input.",
    prompt: JSON.stringify({
      instruction:
        "Return a concise digest headline and one-sentence digest summary for this final reviewed issue.",
      items,
    }),
    schema: reviewDigestSchema,
    providerOptions: {
      anthropic: { structuredOutputMode: "outputFormat" },
    },
    temperature: 0,
    maxRetries: 2,
    abortSignal: options.abortSignal,
  });

  return {
    headline: result.object.headline,
    summary: result.object.summary,
  };
}
