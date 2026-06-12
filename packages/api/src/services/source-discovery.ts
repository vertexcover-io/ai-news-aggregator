import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import type { TenantSourceType } from "@newsletter/shared/db";

const logger = createLogger("api:source-discovery");

export interface TavilyHit {
  title: string;
  url: string;
  content: string;
}

export interface SourceCandidate {
  type: TenantSourceType;
  title: string;
  url: string;
  description: string;
}

export type TavilySearchFn = (query: string) => Promise<TavilyHit[]>;
export type CandidateFilterFn = (
  topic: string,
  hits: TavilyHit[],
) => Promise<SourceCandidate[]>;

export class SourceDiscoveryError extends Error {}

export interface SourceDiscovery {
  /** Returns add-candidates only — callers must never persist them automatically (REQ-071). */
  discover(topic: string): Promise<SourceCandidate[]>;
}

export interface SourceDiscoveryClients {
  search: TavilySearchFn;
  filter: CandidateFilterFn;
}

export function createSourceDiscovery(clients: SourceDiscoveryClients): SourceDiscovery {
  return {
    async discover(topic: string): Promise<SourceCandidate[]> {
      const hits = await clients.search(
        `best news sites, engineering blogs, and subreddits covering ${topic}`,
      );
      if (hits.length === 0) return [];
      return clients.filter(topic, hits);
    },
  };
}

const tavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string().default(""),
    }),
  ),
});

export function createTavilySearch(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): TavilySearchFn {
  return async (query: string): Promise<TavilyHit[]> => {
    const res = await fetchFn("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, max_results: 10 }),
    });
    if (!res.ok) {
      throw new SourceDiscoveryError(`tavily search failed: ${res.status}`);
    }
    const parsed = tavilyResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new SourceDiscoveryError("tavily search returned an unexpected shape");
    }
    return parsed.data.results;
  };
}

const candidateSchema = z.object({
  type: z.enum(["hn", "reddit", "web", "twitter", "web_search"]),
  title: z.string().min(1),
  url: z.string().min(1),
  description: z.string().default(""),
});

const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({ type: z.string(), text: z.string().optional() }),
  ),
});

const DEFAULT_FILTER_MODEL = "claude-haiku-4-5-20251001";

function buildFilterPrompt(topic: string, hits: TavilyHit[]): string {
  const hitsBlock = hits
    .map((h) => `- title: ${h.title}\n  url: ${h.url}\n  summary: ${h.content.slice(0, 300)}`)
    .join("\n");
  return [
    `You curate recurring news sources for a newsletter about: ${topic}.`,
    `From the web search results below, select the entries that are ongoing publication sources (news sites, engineering blogs, subreddits) worth collecting from regularly — not one-off articles.`,
    `Respond with ONLY a JSON array (no prose, no code fences). Each element: {"type": "web" | "reddit", "title": string, "url": string, "description": string}. Use "reddit" only for reddit.com subreddit URLs; use "web" otherwise. Return [] if nothing qualifies.`,
    ``,
    hitsBlock,
  ].join("\n");
}

export function createAnthropicCandidateFilter(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  model: string = DEFAULT_FILTER_MODEL,
): CandidateFilterFn {
  return async (topic: string, hits: TavilyHit[]): Promise<SourceCandidate[]> => {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildFilterPrompt(topic, hits) }],
      }),
    });
    if (!res.ok) {
      throw new SourceDiscoveryError(`candidate filter failed: ${res.status}`);
    }
    const parsed = anthropicResponseSchema.safeParse(await res.json());
    const text = parsed.success
      ? parsed.data.content.find((b) => b.type === "text")?.text
      : undefined;
    if (text === undefined) {
      throw new SourceDiscoveryError("candidate filter returned no text");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new SourceDiscoveryError("candidate filter returned invalid JSON");
    }
    const candidates = z.array(candidateSchema).safeParse(raw);
    if (!candidates.success) {
      throw new SourceDiscoveryError("candidate filter returned an unexpected shape");
    }
    return candidates.data;
  };
}

export interface SourceDiscoveryEnv {
  TAVILY_API_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
}

export function createDefaultSourceDiscovery(
  env: SourceDiscoveryEnv,
  fetchFn: typeof fetch = fetch,
): SourceDiscovery | null {
  const tavilyKey = env.TAVILY_API_KEY?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (!tavilyKey || !anthropicKey) {
    logger.info(
      { event: "source-discovery.disabled", hasTavily: Boolean(tavilyKey), hasAnthropic: Boolean(anthropicKey) },
      "source discovery disabled: missing API key",
    );
    return null;
  }
  return createSourceDiscovery({
    search: createTavilySearch(tavilyKey, fetchFn),
    filter: createAnthropicCandidateFilter(anthropicKey, fetchFn),
  });
}
