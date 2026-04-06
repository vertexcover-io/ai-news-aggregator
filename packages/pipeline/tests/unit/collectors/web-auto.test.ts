import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollectorResult } from "@newsletter/shared/types";
import type { WebAutoCollectConfig, WebAutoSourceConfig, WebSourceSelectors } from "@pipeline/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { GeminiClient } from "@pipeline/collectors/web-selectors.js";
import type { SelectorCache } from "@pipeline/collectors/selector-cache.js";

const indexHtml = readFileSync(
  resolve(__dirname, "../fixtures/web-index.html"),
  "utf-8",
);
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

const DEFAULT_SELECTORS: WebSourceSelectors = {
  articleLink: ".posts a",
  title: "h1.title",
  content: "div.content",
  author: "span.author",
  date: "time.date",
};

function createMockGeminiClient(): GeminiClient & { generateContent: ReturnType<typeof vi.fn> } {
  return {
    generateContent: vi.fn(),
  };
}

function createMockCache(): SelectorCache & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    invalidate: vi.fn(),
    save: vi.fn(),
  };
}

function makeAutoSource(overrides: Partial<WebAutoSourceConfig> = {}): WebAutoSourceConfig {
  return {
    name: "Test Blog",
    sourceType: "blog",
    indexUrl: "https://example.com/blog",
    ...overrides,
  };
}

function makeAutoConfig(sources: WebAutoSourceConfig[] = [makeAutoSource()]): WebAutoCollectConfig {
  return { sources };
}

// Mock selector-cache module to inject our mock cache
vi.mock("@pipeline/collectors/selector-cache.js", () => ({
  createSelectorCache: vi.fn(),
}));

type CollectWebAutoFn = (
  deps: {
    rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn };
    fetchFn: MockFetchFn;
    geminiClient: GeminiClient;
    selectorCache: SelectorCache;
  },
  config: WebAutoCollectConfig,
) => Promise<CollectorResult>;

describe("collectWebAuto", () => {
  let collectWebAuto: CollectWebAutoFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    const mod = await import("@pipeline/collectors/web-auto.js");
    collectWebAuto = mod.collectWebAuto as CollectWebAutoFn;
  });

  // REQ-004: Cache hit → no LLM call
  it("uses cached selectors and skips LLM when cache has entry", async () => {
    const mockCache = createMockCache();
    mockCache.get.mockReturnValue(DEFAULT_SELECTORS);

    const mockGemini = createMockGeminiClient();
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),   // index page
      htmlResponse(articleHtml), // article 1
      htmlResponse(articleHtml), // article 2
      htmlResponse(articleHtml), // article 3
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig(),
    );

    expect(mockCache.get).toHaveBeenCalledWith("https://example.com/blog");
    expect(mockGemini.generateContent).not.toHaveBeenCalled();
    expect(result.itemsFetched).toBe(3);
    expect(result.itemsStored).toBe(3);
  });

  // REQ-005: Cache miss → LLM called → cache updated
  it("derives selectors via LLM on cache miss and saves to cache", async () => {
    const mockCache = createMockCache();
    mockCache.get.mockReturnValue(null);

    const mockGemini = createMockGeminiClient();
    // First call: index extraction → articleLink
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ articleLink: ".posts a" }),
    });
    // Second call: article extraction → title, content, author, date
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ title: "h1.title", content: "div.content", author: "span.author", date: "time.date" }),
    });

    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),   // fetch index for LLM
      htmlResponse(articleHtml), // fetch first article for LLM
      htmlResponse(indexHtml),   // collectSource: fetch index
      htmlResponse(articleHtml), // collectSource: article 1
      htmlResponse(articleHtml), // collectSource: article 2
      htmlResponse(articleHtml), // collectSource: article 3
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig(),
    );

    expect(mockGemini.generateContent).toHaveBeenCalledTimes(2);
    expect(mockCache.set).toHaveBeenCalledWith("https://example.com/blog", expect.objectContaining({
      articleLink: ".posts a",
      title: "h1.title",
      content: "div.content",
    }));
    expect(result.itemsFetched).toBe(3);
  });

  // REQ-006: 0 articles → cache invalidated → LLM re-called → retry
  it("invalidates cache and retries with new selectors when 0 items extracted", async () => {
    const mockCache = createMockCache();
    // First attempt: cache has bad selectors
    const badSelectors: WebSourceSelectors = {
      articleLink: ".nonexistent a",
      title: "h1.nonexistent",
      content: "div.nonexistent",
    };
    mockCache.get.mockReturnValueOnce(badSelectors).mockReturnValueOnce(null);

    const mockGemini = createMockGeminiClient();
    // After invalidation, derive new selectors
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ articleLink: ".posts a" }),
    });
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ title: "h1.title", content: "div.content", author: "span.author", date: "time.date" }),
    });

    // Index with bad selectors yields 0 links, then re-derive and retry
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),   // first collectSource: index (bad selectors → 0 links)
      // invalidate + re-derive:
      htmlResponse(indexHtml),   // fetch index for LLM
      htmlResponse(articleHtml), // fetch first article for LLM
      // retry collectSource:
      htmlResponse(indexHtml),   // index page
      htmlResponse(articleHtml), // article 1
      htmlResponse(articleHtml), // article 2
      htmlResponse(articleHtml), // article 3
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig(),
    );

    expect(mockCache.invalidate).toHaveBeenCalledWith("https://example.com/blog");
    expect(mockGemini.generateContent).toHaveBeenCalledTimes(2);
    expect(result.itemsFetched).toBe(3);
  });

  // REQ-009: Retry still fails → source skipped
  it("skips source when retry also produces 0 items", async () => {
    const mockCache = createMockCache();
    const badSelectors: WebSourceSelectors = {
      articleLink: ".nonexistent a",
      title: "h1.nonexistent",
      content: "div.nonexistent",
    };
    mockCache.get.mockReturnValueOnce(badSelectors).mockReturnValueOnce(null);

    const mockGemini = createMockGeminiClient();
    // LLM returns selectors that also don't work
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ articleLink: ".also-bad a" }),
    });
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ title: "h1.also-bad", content: "div.also-bad" }),
    });

    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),   // first attempt: index (bad selectors → 0)
      // re-derive:
      htmlResponse(indexHtml),   // fetch index for LLM
      htmlResponse(articleHtml), // fetch article for LLM (will use bad articleLink, but we need the HTML for extraction)
      // retry:
      htmlResponse(indexHtml),   // index page (still bad selectors → 0)
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig(),
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
  });

  // REQ-012: Explicit selectors → no LLM or cache
  it("uses explicit selectors without LLM or cache when source has selectors", async () => {
    const mockCache = createMockCache();
    const mockGemini = createMockGeminiClient();
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),   // index page
      htmlResponse(articleHtml), // article 1
      htmlResponse(articleHtml), // article 2
      htmlResponse(articleHtml), // article 3
    ]);
    const rawItemsRepo = createMockRepo();

    const sourceWithSelectors = makeAutoSource({ selectors: DEFAULT_SELECTORS });
    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig([sourceWithSelectors]),
    );

    expect(mockCache.get).not.toHaveBeenCalled();
    expect(mockGemini.generateContent).not.toHaveBeenCalled();
    expect(result.itemsFetched).toBe(3);
    expect(result.itemsStored).toBe(3);
  });

  // EDGE-005: Articles fail → triggers retry
  it("retries with new selectors when all article fetches fail", { timeout: 60000 }, async () => {
    const mockCache = createMockCache();
    mockCache.get.mockReturnValueOnce(DEFAULT_SELECTORS).mockReturnValueOnce(null);

    const mockGemini = createMockGeminiClient();
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ articleLink: ".posts a" }),
    });
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ title: "h1.title", content: "div.content" }),
    });

    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/only">Only</a></div></body></html>`;

    const mockFetch = createMockFetch([
      // First attempt: index ok, article fails (3 retries)
      htmlResponse(singleLinkIndex),
      { ok: false, status: 500, body: "error" },
      { ok: false, status: 500, body: "error" },
      { ok: false, status: 500, body: "error" },
      // Re-derive:
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
      // Retry collectSource:
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig(),
    );

    expect(mockCache.invalidate).toHaveBeenCalledWith("https://example.com/blog");
    expect(result.itemsFetched).toBe(1);
  });

  // EDGE-009: Explicit selectors bypass everything (same as REQ-012 but verifying cache.set is not called)
  it("does not update cache when explicit selectors are used", async () => {
    const mockCache = createMockCache();
    const mockGemini = createMockGeminiClient();
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const sourceWithSelectors = makeAutoSource({ selectors: DEFAULT_SELECTORS });
    await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig([sourceWithSelectors]),
    );

    expect(mockCache.set).not.toHaveBeenCalled();
    expect(mockCache.invalidate).not.toHaveBeenCalled();
  });

  // EDGE-010: Useless selectors → retry → skip
  // LLM finds links but article selectors extract no title → 0 items → retry → still 0 → skip
  it("retries once then skips when LLM-derived selectors are useless", async () => {
    const mockCache = createMockCache();
    mockCache.get.mockReturnValue(null);

    const mockGemini = createMockGeminiClient();
    // First derivation: articleLink works but article selectors are garbage
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ articleLink: ".posts a" }),
    });
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ title: "h1.garbage", content: "div.garbage" }),
    });
    // Second derivation after invalidation: still useless article selectors
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ articleLink: ".posts a" }),
    });
    mockGemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ title: "h1.still-garbage", content: "div.still-garbage" }),
    });

    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/p1">P1</a></div></body></html>`;

    const mockFetch = createMockFetch([
      // First derive:
      htmlResponse(singleLinkIndex), // fetch index for LLM
      htmlResponse(articleHtml),      // fetch first article for LLM
      // First collectSource: article has no matching title → 0 items
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
      // Re-derive:
      htmlResponse(singleLinkIndex), // fetch index for LLM
      htmlResponse(articleHtml),      // fetch first article for LLM
      // Retry collectSource: still garbage selectors → 0 items
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig(),
    );

    expect(mockGemini.generateContent).toHaveBeenCalledTimes(4); // 2 per derivation * 2 derivations
    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
  });

  it("aggregates results across multiple sources", async () => {
    const mockCache = createMockCache();
    mockCache.get.mockReturnValue(DEFAULT_SELECTORS);

    const mockGemini = createMockGeminiClient();

    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/p1">P1</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const source1 = makeAutoSource({ name: "Blog 1", indexUrl: "https://blog1.com" });
    const source2 = makeAutoSource({ name: "Blog 2", indexUrl: "https://blog2.com" });

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig([source1, source2]),
    );

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsStored).toBe(2);
    expect(result.commentsFetched).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns zero results for empty sources array", async () => {
    const mockCache = createMockCache();
    const mockGemini = createMockGeminiClient();
    const mockFetch = createMockFetch([]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWebAuto(
      { rawItemsRepo, fetchFn: mockFetch, geminiClient: mockGemini, selectorCache: mockCache },
      makeAutoConfig([]),
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
