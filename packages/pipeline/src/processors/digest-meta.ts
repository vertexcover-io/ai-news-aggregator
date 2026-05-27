import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createLogger } from "@newsletter/shared/logger";
import { DIGEST_META_INSTRUCTIONS, digestSchema } from "@newsletter/shared/constants";
import type { DigestMeta } from "@newsletter/shared/constants";
import type { CostTracker } from "@pipeline/services/cost-tracker.js";
import { TWITTER_SUMMARY_MAX_CHARS } from "@pipeline/processors/rank.js";

const logger = createLogger("processor:digest-meta");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const TWITTER_SUMMARY_RETRY_INSTRUCTION =
  "The previous digest.twitterSummary exceeded twitterSummaryMaxChars. Regenerate the full response with digest.twitterSummary as ONE sentence within twitterSummaryMaxChars. Count every letter, space, and punctuation mark. Do not include more than two facts.";

export interface DigestMetaInputItem {
  rank: number;
  title: string;
  summary: string;
  bottomLine: string;
}

export interface GenerateDigestMetaOptions {
  generateObject?: typeof defaultGenerateObject;
  modelId?: string;
  runId?: string;
  abortSignal?: AbortSignal;
  tracker?: CostTracker;
}

export async function generateDigestMeta(
  items: DigestMetaInputItem[],
  options: GenerateDigestMetaOptions = {},
): Promise<DigestMeta> {
  if (items.length === 0) {
    throw new Error("generateDigestMeta: empty item list");
  }

  const generate = options.generateObject ?? defaultGenerateObject;
  const modelId = options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  const basePayload = {
    twitterSummaryMaxChars: TWITTER_SUMMARY_MAX_CHARS,
    items,
  };

  type GenerateDigestResult = Awaited<ReturnType<typeof generate>> & {
    object: DigestMeta;
  };

  const callModel = (retry: boolean): Promise<GenerateDigestResult> =>
    generate({
      model: anthropic(modelId),
      system: DIGEST_META_INSTRUCTIONS,
      prompt: JSON.stringify(
        retry
          ? { ...basePayload, retryInstruction: TWITTER_SUMMARY_RETRY_INSTRUCTION }
          : basePayload,
        null,
        2,
      ),
      schema: digestSchema,
      providerOptions: {
        anthropic: { structuredOutputMode: "outputFormat" },
      },
      temperature: 0,
      maxRetries: 2,
      abortSignal: options.abortSignal,
    }) as Promise<GenerateDigestResult>;

  let result = await callModel(false);
  if (result.object.twitterSummary.length > TWITTER_SUMMARY_MAX_CHARS) {
    logger.warn(
      {
        event: "digest.twitter_summary_over_budget",
        runId: options.runId,
        length: result.object.twitterSummary.length,
        budget: TWITTER_SUMMARY_MAX_CHARS,
      },
      "digest.twitter_summary_over_budget",
    );
    result = await callModel(true);
  }

  options.tracker?.record({
    stage: "digest",
    modelId,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
  });

  return {
    headline: result.object.headline,
    summary: result.object.summary,
    hook: result.object.hook,
    twitterSummary: result.object.twitterSummary,
  };
}
