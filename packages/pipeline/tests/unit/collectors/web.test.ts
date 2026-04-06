import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollectorResult } from "@newsletter/shared/types";
import type { WebCollectConfig } from "@pipeline/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { GeminiClient, ArticleSelectors } from "@pipeline/llm.js";

vi.mock("@pipeline/llm.js", async () => {
  const actual = await vi.importActual<typeof import("@pipeline/llm.js")>("@pipeline/llm.js");
  return actual;
});

const articleHtml = readFileSync(
  resolve(__dirname, "../fixtures/web-article.html"),
  "utf-8",
);

type MockUpsertFn = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsertFn } {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

interface MockResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

type MockFetchFn = ReturnType<typeof vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>>;

function htmlResponse(body: string): { ok: boolean; status: number; body: string } {
  return { ok: true, status: 200, body };
}

function errorResponse(status: number): { ok: boolean; status: number; body: string } {
  return { ok: false, status, body: "<html>Error</html>" };
}

function createMockFetch(responses: { ok: boolean; status: number; body: string }[]): MockFetchFn {
  let callIndex = 0;
  return vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    if (!resp) {
      return Promise.reject(new Error("Network error"));
    }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      text: () => Promise.resolve(resp.body),
    });
  });
}

const DEFAULT_SELECTORS: ArticleSelectors = {
  title: "h1.title",
  content: "div.content",
  author: "span.author",
  date: "time.date",
};

function createMockGeminiClient(selectors: ArticleSelectors = DEFAULT_SELECTORS): GeminiClient & { generateContent: ReturnType<typeof vi.fn> } {
  return {
    generateContent: vi.fn().mockResolvedValue({
      text: JSON.stringify(selectors),
    }),
  };
}

function makeConfig(urls: string[] = ["https://example.com/blog/post-1"], sourceType: "blog" | "rss" = "blog"): WebCollectConfig {
  return { urls, sourceType };
}

type CollectWebFn = (
  deps: {
    rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn };
    fetchFn: MockFetchFn;
    geminiClient: GeminiClient;
  },
  config: WebCollectConfig,
) => Promise<CollectorResult>;

describe("collectWeb", () => {
  let collectWeb: CollectWebFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import("@pipeline/collectors/web.js");
    collectWeb = mod.collectWeb as CollectWebFn;
  });

  it("fetches URL, derives selectors via Gemini, extracts content via Cheerio", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/blog/post-1");
    expect(geminiClient.generateContent).toHaveBeenCalledOnce();
    expect(result.itemsFetched).toBe(1);
    expect(result.itemsStored).toBe(1);
  });

  it("extracts title, content, author, and date from article page", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const item = rows[0];
    expect(item.title).toBe("Article Title");
    expect(item.content).toBe("Article body text here.");
    expect(item.author).toBe("Jane Doe");
    expect(item.publishedAt).toEqual(new Date("2026-04-01"));
  });

  it("sets externalId to the URL pathname", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(["https://example.com/blog/post-1"]),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].externalId).toBe("/blog/post-1");
  });

  it("sets sourceType from the config", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(["https://example.com/post"], "rss"),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].sourceType).toBe("rss");
  });

  it("returns CollectorResult with correct fields", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("processes multiple URLs sequentially", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig([
        "https://example.com/post-1",
        "https://example.com/post-2",
        "https://example.com/post-3",
      ]),
    );

    expect(result.itemsFetched).toBe(3);
    expect(result.itemsStored).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("enforces >= 1000ms delay between consecutive URL fetches", async () => {
    const timestamps: number[] = [];
    const responses = [htmlResponse(articleHtml), htmlResponse(articleHtml)];
    let callIndex = 0;
    const mockFetch = vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>().mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      timestamps.push(Date.now());
      return Promise.resolve({
        ok: resp.ok,
        status: resp.status,
        text: () => Promise.resolve(resp.body),
      });
    });
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch as MockFetchFn, geminiClient },
      makeConfig(["https://example.com/post-1", "https://example.com/post-2"]),
    );

    expect(timestamps).toHaveLength(2);
    const gap = timestamps[1] - timestamps[0];
    expect(gap).toBeGreaterThanOrEqual(990);
  });

  it("retries on 502 up to 3 times then skips URL", async () => {
    const mockFetch = createMockFetch([
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.itemsFetched).toBe(0);
  });

  it("does not retry on 404 and skips the URL", async () => {
    const mockFetch = createMockFetch([errorResponse(404)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.itemsFetched).toBe(0);
  });

  it("skips URL on Gemini failure and continues to next", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();
    const geminiClient: GeminiClient = {
      generateContent: vi.fn()
        .mockRejectedValueOnce(new Error("Gemini down"))
        .mockResolvedValueOnce({ text: JSON.stringify(DEFAULT_SELECTORS) }),
    };

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(["https://example.com/post-1", "https://example.com/post-2"]),
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.itemsStored).toBe(1);
  });

  it("skips URL when Cheerio finds no title", async () => {
    const noTitleHtml = "<html><body><div class='content'>No title here</div></body></html>";
    const mockFetch = createMockFetch([htmlResponse(noTitleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient({ title: "h1.title", content: "div.content" });

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    expect(result.itemsFetched).toBe(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  it("sets engagement to {points:0,commentCount:0} and metadata to {comments:[]}", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].engagement).toEqual({ points: 0, commentCount: 0 });
    expect(rows[0].metadata).toEqual({ comments: [] });
  });

  it("returns zero results for empty urls array", async () => {
    const mockFetch = createMockFetch([]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig([]),
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("strips query parameters and fragments from externalId", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(["https://example.com/blog/post?utm=123#section"]),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].externalId).toBe("/blog/post");
  });

  it("sets author and publishedAt to null when selectors not provided by Gemini", async () => {
    const mockFetch = createMockFetch([htmlResponse(articleHtml)]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient({ title: "h1.title", content: "div.content" });

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].author).toBeNull();
    expect(rows[0].publishedAt).toBeNull();
  });

  it("retries on network error and skips after exhaustion", async () => {
    const networkError = new Error("Network timeout");
    const mockFetch = vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch as MockFetchFn, geminiClient },
      makeConfig(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.itemsFetched).toBe(0);
  });

  it("continues to next URL when one fails", { timeout: 30000 }, async () => {
    const mockFetch = createMockFetch([
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();
    const geminiClient = createMockGeminiClient();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient },
      makeConfig(["https://example.com/fail", "https://example.com/succeed"]),
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.itemsStored).toBe(1);
  });
});
