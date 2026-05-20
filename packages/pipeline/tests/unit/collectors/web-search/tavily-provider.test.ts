import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock @tavily/core before any imports that might load it ---
const mockSearch = vi.fn();
vi.mock("@tavily/core", () => ({
  tavily: (_opts: { apiKey: string }) => ({ search: mockSearch }),
}));

import { TavilyProvider } from "@pipeline/collectors/web-search/providers/tavily.js";
import type { SearchInput } from "@pipeline/collectors/web-search/providers/types.js";

// Canned response matching the probe shape
const CANNED_RESULT = {
  title: "Agents are eating software",
  url: "https://example.com/agents",
  content: "A short snippet about agentic AI.",
  rawContent: null,
  score: 0.87,
  publishedDate: "2026-05-18T10:00:00Z",
  favicon: "https://example.com/favicon.ico",
};

const CANNED_RESPONSE = {
  query: "agentic AI",
  responseTime: 1.2,
  requestId: "req-abc",
  answer: null,
  images: [{ url: "https://example.com/img.png" }], // query-level images, NOT per-result
  results: [CANNED_RESULT],
};

const BASE_INPUT: SearchInput = {
  query: "agentic AI",
  sinceDays: 7,
  maxItems: 5,
};

describe("TavilyProvider", () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  it("throws on blank apiKey", () => {
    expect(() => new TavilyProvider({ apiKey: "" })).toThrow();
    expect(() => new TavilyProvider({ apiKey: "   " })).toThrow();
  });

  it("has name === 'tavily'", () => {
    const provider = new TavilyProvider({ apiKey: "test-key" });
    expect(provider.name).toBe("tavily");
  });

  it("calls tavily SDK with correct options", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    await provider.search(BASE_INPUT);

    expect(mockSearch).toHaveBeenCalledOnce();
    expect(mockSearch).toHaveBeenCalledWith("agentic AI", {
      topic: "news",
      days: 7,
      maxResults: 5,
      includeImages: true,
      includeRawContent: false,
    });
  });

  it("maps content → snippet", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe(CANNED_RESULT.content);
  });

  it("maps score → rawScore", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].rawScore).toBe(CANNED_RESULT.score);
  });

  it("maps publishedDate → publishedAt as Date", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].publishedAt).toBeInstanceOf(Date);
    expect((results[0].publishedAt as Date).toISOString()).toBe(
      "2026-05-18T10:00:00.000Z",
    );
  });

  it("returns null publishedAt when publishedDate is missing", async () => {
    const resultWithoutDate = { ...CANNED_RESULT, publishedDate: undefined };
    mockSearch.mockResolvedValueOnce({
      ...CANNED_RESPONSE,
      results: [resultWithoutDate],
    });
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].publishedAt).toBeNull();
  });

  it("returns null publishedAt when publishedDate is a malformed string", async () => {
    const resultWithBadDate = {
      ...CANNED_RESULT,
      publishedDate: "not-a-date",
    };
    mockSearch.mockResolvedValueOnce({
      ...CANNED_RESPONSE,
      results: [resultWithBadDate],
    });
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].publishedAt).toBeNull();
  });

  it("leaves imageUrl undefined (images are query-level, not per-result)", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].imageUrl).toBeUndefined();
  });

  it("includes favicon and score in providerMetadata", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].providerMetadata).toEqual({
      favicon: CANNED_RESULT.favicon,
      score: CANNED_RESULT.score,
    });
  });

  it("maps url and title directly", async () => {
    mockSearch.mockResolvedValueOnce(CANNED_RESPONSE);
    const provider = new TavilyProvider({ apiKey: "test-key" });
    const results = await provider.search(BASE_INPUT);

    expect(results[0].url).toBe(CANNED_RESULT.url);
    expect(results[0].title).toBe(CANNED_RESULT.title);
  });

  it("bubbles SDK errors with cause set", async () => {
    const sdkError = new Error("HTTP 500");
    mockSearch.mockRejectedValueOnce(sdkError);
    const provider = new TavilyProvider({ apiKey: "test-key" });

    await expect(provider.search(BASE_INPUT)).rejects.toMatchObject({
      cause: sdkError,
    });
  });
});
