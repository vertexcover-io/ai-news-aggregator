import { tavily } from "@tavily/core";
import type { SearchInput, WebSearchProvider, WebSearchResult } from "./types.js";

export class TavilyProvider implements WebSearchProvider {
  public readonly name = "tavily";
  private readonly client: ReturnType<typeof tavily>;

  constructor(options: { apiKey: string }) {
    if (!options.apiKey) {
      throw new Error("TAVILY_API_KEY is required for the tavily web-search provider");
    }
    this.client = tavily({ apiKey: options.apiKey });
  }

  async search(input: SearchInput): Promise<WebSearchResult[]> {
    const response = await this.client.search(input.query, {
      topic: "news",
      days: input.sinceDays,
      maxResults: input.maxItems,
      // Per-article images are filled downstream by link-enrichment; the
      // top-level images[] is query-level and unused here.
      includeImages: false,
      includeRawContent: false,
    });

    return response.results.map((r): WebSearchResult => ({
      url: r.url,
      title: r.title,
      snippet: r.content,
      publishedAt: parseDate(r.publishedDate),
      imageUrl: undefined,
      rawScore: typeof r.score === "number" ? r.score : undefined,
      providerMetadata: { favicon: r.favicon, score: r.score },
    }));
  }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
