import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  createLogger,
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
} from "@newsletter/shared";

const logger = createLogger("api:prompt-generation");

export interface GeneratedPrompts {
  rankingPrompt: string;
  shortlistPrompt: string;
}

/** Injectable LLM boundary: takes the assembled prompt, returns the raw
 * (unvalidated) model output. Tests stub this; the default uses the Vercel
 * AI SDK with Anthropic. */
export type PromptLlm = (prompt: string) => Promise<unknown>;

export class PromptGenerationError extends Error {}

export interface PromptGeneration {
  /** REQ-036: tailors the default ranking + shortlist prompts to the tenant's
   * newsletter description. Output is a candidate — the user edits and saves
   * it separately. */
  generate(description: string): Promise<GeneratedPrompts>;
}

const generatedPromptsSchema = z.object({
  rankingPrompt: z.string().min(1),
  shortlistPrompt: z.string().min(1),
});

export function buildPromptGenerationPrompt(description: string): string {
  return [
    `You write the editorial LLM prompts for a configurable daily-newsletter pipeline.`,
    `A tenant has described their newsletter as:`,
    ``,
    `"""${description}"""`,
    ``,
    `Produce TWO prompts tailored to that description, using the reference prompts below as the structural template:`,
    ``,
    `1. rankingPrompt — instructs an LLM how to rank collected news candidates for this newsletter's reader. Keep the same overall shape as the reference (reader profile, boost/downrank guidance, scoring axes with exact axis names, rationale rules) but rewrite the editorial substance around the tenant's topic and audience.`,
    `2. shortlistPrompt — instructs an LLM how to pick the {{N}} most newsletter-worthy items from titles alone. CRITICAL: keep the "{{N}}" placeholder verbatim and keep the strict OUTPUT CONTRACT section (the JSON {"ids": [...]} shape) byte-compatible with the reference. Rewrite only the editorial guidance.`,
    ``,
    `--- REFERENCE RANKING PROMPT ---`,
    DEFAULT_RANKING_PROMPT,
    `--- END REFERENCE RANKING PROMPT ---`,
    ``,
    `--- REFERENCE SHORTLIST PROMPT ---`,
    DEFAULT_SHORTLIST_PROMPT,
    `--- END REFERENCE SHORTLIST PROMPT ---`,
  ].join("\n");
}

export function createPromptGeneration(llm: PromptLlm): PromptGeneration {
  return {
    async generate(description: string): Promise<GeneratedPrompts> {
      let raw: unknown;
      try {
        raw = await llm(buildPromptGenerationPrompt(description));
      } catch (err) {
        throw new PromptGenerationError(
          `prompt generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const parsed = generatedPromptsSchema.safeParse(raw);
      if (!parsed.success) {
        throw new PromptGenerationError(
          "prompt generation returned an unexpected shape",
        );
      }
      // The pipeline substitutes {{N}} at shortlist time — a generated prompt
      // that dropped it would silently break the tenant's shortlist step.
      if (!parsed.data.shortlistPrompt.includes("{{N}}")) {
        throw new PromptGenerationError(
          "generated shortlist prompt lost the {{N}} placeholder",
        );
      }
      return parsed.data;
    },
  };
}

const PROMPT_GENERATION_MODEL = "claude-haiku-4-5-20251001";

export interface PromptGenerationEnv {
  ANTHROPIC_API_KEY?: string | undefined;
}

/** null when ANTHROPIC_API_KEY is unset — the route answers 503 cleanly. */
export function createDefaultPromptGeneration(
  env: PromptGenerationEnv,
): PromptGeneration | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    logger.info(
      { event: "prompt-generation.disabled" },
      "prompt generation disabled: ANTHROPIC_API_KEY not configured",
    );
    return null;
  }
  const anthropic = createAnthropic({ apiKey });
  return createPromptGeneration(async (prompt) => {
    const result = await generateObject({
      model: anthropic(PROMPT_GENERATION_MODEL),
      schema: generatedPromptsSchema,
      prompt,
    });
    return result.object;
  });
}
