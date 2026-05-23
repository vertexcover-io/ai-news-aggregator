import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Candidate } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared";
import type { CostTracker } from "@pipeline/services/cost-tracker.js";

const logger = createLogger("processor:shortlist");

export const DEFAULT_SHORTLIST_MODEL = "claude-haiku-4-5-20251001";

export interface ShortlistOptions {
  readonly shortlistSize: number;
  readonly systemPrompt: string;
  readonly runId: string;
  readonly modelId?: string;
  readonly tracker?: CostTracker;
  readonly abortSignal?: AbortSignal;
  /** test injection seam — defaults to ai/generateObject */
  readonly generate?: typeof defaultGenerateObject;
}

/**
 * Kept as an empty-array type alias for callers that still typecheck against
 * `breakdowns`. The LLM-based shortlister no longer produces per-item scoring
 * breakdowns — the field is preserved as `never[]` for back-compat with rank's
 * optional `shortlistBreakdowns` param.
 */
export interface ShortlistResult {
  readonly shortlist: Candidate[];
  readonly breakdowns: never[];
}

const shortlistResponseSchema = z.object({
  ids: z.array(z.string()),
});

export async function shortlistCandidates(
  candidates: Candidate[],
  options: ShortlistOptions,
): Promise<ShortlistResult> {
  const startedAt = Date.now();
  const generate = options.generate ?? defaultGenerateObject;
  const modelId =
    options.modelId ?? process.env.SHORTLIST_MODEL ?? DEFAULT_SHORTLIST_MODEL;

  logger.info(
    {
      event: "shortlist.start",
      runId: options.runId,
      candidateCount: candidates.length,
      shortlistSize: options.shortlistSize,
      modelId,
    },
    "shortlist stage started",
  );

  if (candidates.length === 0) {
    logger.info(
      {
        event: "shortlist.end",
        runId: options.runId,
        stage: "shortlist",
        inputCount: 0,
        outputCount: 0,
        durationMs: Date.now() - startedAt,
      },
      "shortlist stage completed",
    );
    return { shortlist: [], breakdowns: [] };
  }

  const idMap = new Map<string, Candidate>(
    candidates.map((c) => [String(c.id), c]),
  );

  const promptPayload = {
    shortlistSize: options.shortlistSize,
    candidates: candidates.map((c) => ({
      id: String(c.id),
      title: c.title,
    })),
  };

  type GenerateShortlistResult = Awaited<ReturnType<typeof generate>> & {
    object: z.infer<typeof shortlistResponseSchema>;
  };

  const result = (await generate({
    model: anthropic(modelId),
    system: options.systemPrompt,
    prompt: JSON.stringify(promptPayload, null, 2),
    schema: shortlistResponseSchema,
    providerOptions: {
      anthropic: { structuredOutputMode: "outputFormat" },
    },
    temperature: 0,
    maxRetries: 2,
    abortSignal: options.abortSignal,
  })) as GenerateShortlistResult;

  options.tracker?.record({
    stage: "shortlist",
    modelId,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
  });

  const shortlist: Candidate[] = [];
  for (const id of result.object.ids) {
    const candidate = idMap.get(id);
    if (candidate === undefined) {
      logger.warn(
        {
          event: "shortlist.unknown_id",
          runId: options.runId,
          id,
        },
        "shortlist LLM returned id not in input set; dropping",
      );
      continue;
    }
    shortlist.push(candidate);
  }

  logger.info(
    {
      event: "shortlist.end",
      runId: options.runId,
      stage: "shortlist",
      inputCount: candidates.length,
      outputCount: shortlist.length,
      durationMs: Date.now() - startedAt,
    },
    "shortlist stage completed",
  );

  return { shortlist, breakdowns: [] };
}
