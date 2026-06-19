/**
 * Production wiring for the onboarding wizard's AI-backed endpoints (P11).
 *
 *   - `defaultGeneratePrompts` (REQ-036): Anthropic (Vercel AI SDK
 *     `generateObject`, same pattern as the pipeline processors) turns the
 *     tenant's blurb into a tailored ranking + shortlist prompt pair, using
 *     the platform default prompts as the style/contract anchor.
 *   - `defaultDiscoverSources` (REQ-051): Tavily `.search()` finds live
 *     communities/blogs for the blurb, then the LLM maps blurb + results to
 *     typed click-to-add candidates (manual-add `type`+`value` pairs).
 *
 * Both are verified live by the library probe and are ONLY referenced from
 * the default router factory — tests inject fakes at the router seam
 * (S-web-04: no real Anthropic/Tavily calls in any test).
 */
import { generateObject as defaultGenerateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { tavily } from "@tavily/core";
import { z } from "zod";
import {
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
} from "@newsletter/shared/constants";
import { MANUAL_SOURCE_TYPES } from "@newsletter/shared/types";
import type {
  GeneratePromptsResponse,
  SourceCandidate,
} from "@newsletter/shared/types/tenant";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const promptsSchema = z.object({
  rankingPrompt: z.string().min(1),
  shortlistPrompt: z.string().min(1),
});

const PROMPT_GEN_SYSTEM = `You write editorial-pipeline prompts for a newsletter platform.
Given a publisher's description of their newsletter, produce TWO prompts:

1. "rankingPrompt" — instructs an LLM how to rank candidate news items for
   this audience: who the reader is, what to reward, what to penalize.
2. "shortlistPrompt" — instructs an LLM which candidate items to keep vs
   drop when building the shortlist.

Match the structure, tone and level of detail of the platform defaults shown
below, but make the content specific to the publisher's description. Keep
each prompt self-contained plain text (no templating beyond what the
defaults use).

--- PLATFORM DEFAULT RANKING PROMPT (style anchor) ---
${DEFAULT_RANKING_PROMPT}

--- PLATFORM DEFAULT SHORTLIST PROMPT (style anchor) ---
${DEFAULT_SHORTLIST_PROMPT}`;

export interface GeneratePromptsOptions {
  generateObject?: typeof defaultGenerateObject;
  modelId?: string;
  env?: NodeJS.ProcessEnv;
}

export function createGeneratePrompts(
  options: GeneratePromptsOptions = {},
): (blurb: string) => Promise<GeneratePromptsResponse> {
  return async (blurb: string): Promise<GeneratePromptsResponse> => {
    const env = options.env ?? process.env;
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("prompt generation unavailable: ANTHROPIC_API_KEY not configured");
    }
    const generate = options.generateObject ?? defaultGenerateObject;
    const modelId = options.modelId ?? env.RANKING_MODEL ?? DEFAULT_MODEL;
    const { object } = await generate({
      model: anthropic(modelId),
      schema: promptsSchema,
      system: PROMPT_GEN_SYSTEM,
      prompt: `Publisher's newsletter description:\n\n${blurb}`,
    });
    return object;
  };
}

export const defaultGeneratePrompts = createGeneratePrompts();

const candidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        type: z.enum(MANUAL_SOURCE_TYPES),
        value: z.string().min(1),
        label: z.string().min(1),
        group: z.string().min(1),
      }),
    )
    .max(16),
});

const DISCOVERY_SYSTEM = `You suggest collection sources for a newsletter platform.
Given a publisher's description and live web-search findings, propose up to
12 concrete sources the platform can poll, as typed candidates:

- type "reddit"  → value is the subreddit name (no "r/" prefix); group "Reddit"
- type "rss" or "blog" → value is the site/feed URL (https://…); group "RSS / Blogs"
- type "twitter" → value is the @handle (with or without "@"); group "X / Handles"
- type "hn"      → value may be "hn"; group "Communities" (include at most once,
  only when Hacker News genuinely fits the audience)

Prefer sources that visibly publish on the described topics. Use the web
findings for URLs you are not certain about; never invent URLs. label is the
short human name shown on the pill.`;

/** Minimal structural slice of the Tavily client the discovery flow needs. */
export interface TavilySearchClient {
  search: (
    query: string,
    options: { maxResults: number },
  ) => Promise<{ results: { title: string; url: string; content: string }[] }>;
}

export interface DiscoverSourcesOptions {
  generateObject?: typeof defaultGenerateObject;
  modelId?: string;
  tavilyFactory?: (apiKey: string) => TavilySearchClient;
  env?: NodeJS.ProcessEnv;
}

export function createDiscoverSources(
  options: DiscoverSourcesOptions = {},
): (blurb: string) => Promise<SourceCandidate[]> {
  return async (blurb: string): Promise<SourceCandidate[]> => {
    const env = options.env ?? process.env;
    if (!env.ANTHROPIC_API_KEY || !env.TAVILY_API_KEY) {
      throw new Error(
        "source discovery unavailable: ANTHROPIC_API_KEY and TAVILY_API_KEY must be configured",
      );
    }
    const makeTavily = options.tavilyFactory ?? ((apiKey: string) => tavily({ apiKey }));
    const client = makeTavily(env.TAVILY_API_KEY);
    const search = await client.search(
      `best blogs, RSS feeds, subreddits and X accounts covering: ${blurb}`,
      { maxResults: 8 },
    );
    const findings = search.results
      .map((r) => `- ${r.title} — ${r.url}\n  ${r.content.slice(0, 200)}`)
      .join("\n");

    const generate = options.generateObject ?? defaultGenerateObject;
    const modelId = options.modelId ?? env.RANKING_MODEL ?? DEFAULT_MODEL;
    const { object } = await generate({
      model: anthropic(modelId),
      schema: candidatesSchema,
      system: DISCOVERY_SYSTEM,
      prompt: `Publisher's newsletter description:\n\n${blurb}\n\nLive web findings:\n${findings}`,
    });
    return object.candidates;
  };
}

export const defaultDiscoverSources = createDiscoverSources();
