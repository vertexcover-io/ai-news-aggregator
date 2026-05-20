import { tavily } from "@tavily/core";
import type { WebSearchProvider, SearchInput, WebSearchResult } from "./types.js";

// Private type for the SDK result shape (verified in library-probe.md)
interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
  favicon: string;
}

function parsePublishedAt(publishedDate: string | undefined | null): Date | null {
  if (!publishedDate) return null;
  const d = new Date(publishedDate);
  return isNaN(d.getTime()) ? null : d;
}

function mapResult(result: TavilyResult): WebSearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.content,
    publishedAt: parsePublishedAt(result.publishedDate),
    rawScore: result.score,
    providerMetadata: { favicon: result.favicon, score: result.score },
  };
}

export class TavilyProvider implements WebSearchProvider {
  readonly name = "tavily";
  private readonly apiKey: string;

  constructor({ apiKey }: { apiKey: string }) {
    if (!apiKey.trim()) {
      throw new Error("TavilyProvider: apiKey must not be blank");
    }
    this.apiKey = apiKey;
  }

  async search(input: SearchInput): Promise<WebSearchResult[]> {
    const client = tavily({ apiKey: this.apiKey });
    try {
      const res = await client.search(input.query, {
        topic: "news",
        days: input.sinceDays,
        maxResults: input.maxItems,
        includeImages: true,
        includeRawContent: false,
      });
      return (res.results as TavilyResult[]).map(mapResult);
    } catch (cause) {
      throw new Error(`Tavily search failed: ${String(cause)}`, { cause });
    }
  }
}
