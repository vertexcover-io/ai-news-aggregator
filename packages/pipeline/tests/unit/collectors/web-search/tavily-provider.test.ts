import { describe, it, expect, vi, beforeEach } from "vitest";
import { TavilyProvider } from "@pipeline/collectors/web-search/providers/tavily.js";
import type { WebSearchResult } from "@pipeline/collectors/web-search/providers/types.js";

const searchMock = vi.fn();
const tavilyFactory = vi.fn(() => ({ search: searchMock }));

vi.mock("@tavily/core", () => ({
  tavily: (opts: { apiKey: string }) => tavilyFactory(opts),
}));

beforeEach(() => {
  searchMock.mockReset();
  tavilyFactory.mockClear();
});

function makeProvider(): TavilyProvider {
  return new TavilyProvider({ apiKey: "test-key" });
}

function first(out: WebSearchResult[]): WebSearchResult {
  const item = out[0];
  if (!item) throw new Error("expected at least one result");
  return item;
}

describe("TavilyProvider", () => {
  it("calls tavily client.search with the expected options", async () => {
    searchMock.mockResolvedValueOnce({ results: [] });

    const provider = makeProvider();
    await provider.search({ query: "AI news", sinceDays: 3, maxItems: 10 });

    expect(tavilyFactory).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("AI news", {
      topic: "news",
      days: 3,
      maxResults: 10,
      includeImages: false,
      includeRawContent: false,
    });
  });

  it("maps each result to WebSearchResult shape", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        {
          title: "OpenAI ships new model",
          url: "https://example.com/article",
          content: "Snippet body",
          rawContent: null,
          score: 0.87,
          publishedDate: "2026-05-15T08:00:00.000Z",
          favicon: "https://example.com/favicon.ico",
        },
      ],
    });

    const provider = makeProvider();
    const out = await provider.search({ query: "q", sinceDays: 1, maxItems: 5 });

    expect(out).toHaveLength(1);
    const item = first(out);
    expect(item.title).toBe("OpenAI ships new model");
    expect(item.url).toBe("https://example.com/article");
    expect(item.snippet).toBe("Snippet body");
    expect(item.rawScore).toBe(0.87);
  });

  it("parses publishedDate (camelCase) into a Date", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        {
          title: "t",
          url: "https://x.test",
          content: "c",
          score: 0.1,
          publishedDate: "2026-05-15T08:00:00.000Z",
        },
      ],
    });

    const provider = makeProvider();
    const out = await provider.search({ query: "q", sinceDays: 1, maxItems: 5 });
    const item = first(out);
    expect(item.publishedAt).toBeInstanceOf(Date);
    expect(item.publishedAt?.toISOString()).toBe("2026-05-15T08:00:00.000Z");
  });

  it("returns publishedAt null when publishedDate is missing or unparseable", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        { title: "a", url: "https://a.test", content: "c", score: 0.1 },
        {
          title: "b",
          url: "https://b.test",
          content: "c",
          score: 0.1,
          publishedDate: "not-a-date",
        },
        {
          title: "c",
          url: "https://c.test",
          content: "c",
          score: 0.1,
          publishedDate: "",
        },
      ],
    });

    const provider = makeProvider();
    const out = await provider.search({ query: "q", sinceDays: 1, maxItems: 5 });
    expect(out.map((r) => r.publishedAt)).toEqual([null, null, null]);
  });

  it("does NOT set imageUrl from top-level images[]", async () => {
    searchMock.mockResolvedValueOnce({
      images: ["https://img.test/hero.png"],
      results: [
        {
          title: "t",
          url: "https://x.test",
          content: "c",
          score: 0.1,
          publishedDate: "2026-05-15T08:00:00.000Z",
        },
      ],
    });

    const provider = makeProvider();
    const out = await provider.search({ query: "q", sinceDays: 1, maxItems: 5 });
    expect(first(out).imageUrl).toBeUndefined();
  });

  it("populates providerMetadata with favicon and score", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        {
          title: "t",
          url: "https://x.test",
          content: "c",
          score: 0.42,
          publishedDate: "2026-05-15T08:00:00.000Z",
          favicon: "https://x.test/favicon.ico",
        },
      ],
    });

    const provider = makeProvider();
    const out = await provider.search({ query: "q", sinceDays: 1, maxItems: 5 });
    expect(first(out).providerMetadata).toEqual({
      favicon: "https://x.test/favicon.ico",
      score: 0.42,
    });
  });

  it("returns [] on empty results", async () => {
    searchMock.mockResolvedValueOnce({ results: [] });
    const provider = makeProvider();
    const out = await provider.search({ query: "q", sinceDays: 1, maxItems: 5 });
    expect(out).toEqual([]);
  });

  it("propagates SDK errors unchanged", async () => {
    const boom = new Error("upstream 500");
    searchMock.mockRejectedValueOnce(boom);
    const provider = makeProvider();
    await expect(
      provider.search({ query: "q", sinceDays: 1, maxItems: 5 }),
    ).rejects.toBe(boom);
  });

  it('exposes name === "tavily"', () => {
    const provider = makeProvider();
    expect(provider.name).toBe("tavily");
  });
});
