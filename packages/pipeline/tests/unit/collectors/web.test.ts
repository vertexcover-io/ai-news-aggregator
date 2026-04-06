import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollectorResult } from "@newsletter/shared/types";
import type { WebCollectConfig, WebSourceConfig } from "@pipeline/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

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

function makeSource(overrides: Partial<WebSourceConfig> = {}): WebSourceConfig {
  return {
    name: "Test Blog",
    sourceType: "blog",
    indexUrl: "https://example.com/blog",
    selectors: {
      articleLink: ".posts a",
      title: "h1.title",
      content: "div.content",
      author: "span.author",
      date: "time.date",
    },
    ...overrides,
  };
}

function makeConfig(sources: WebSourceConfig[] = [makeSource()]): WebCollectConfig {
  return { sources };
}

type CollectWebFn = (
  deps: { rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn }; fetchFn: MockFetchFn },
  config: WebCollectConfig,
) => Promise<CollectorResult>;

describe("collectWeb", () => {
  let collectWeb: CollectWebFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import("@pipeline/collectors/web.js");
    collectWeb = mod.collectWeb as CollectWebFn;
  });

  // REQ-001: Index page fetch + article link extraction via selector
  it("fetches index page and extracts article URLs via configured selector", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/blog");
    expect(result.itemsFetched).toBe(3);
  });

  // REQ-002: Article page fetch + field extraction (title, content, author, date)
  it("extracts title, content, author, and date from article pages", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const item = rows[0];
    expect(item.title).toBe("Article Title");
    expect(item.content).toBe("Article body text here.");
    expect(item.author).toBe("Jane Doe");
    expect(item.publishedAt).toEqual(new Date("2026-04-01"));
  });

  // REQ-003: externalId equals URL pathname
  it("sets externalId to the URL pathname", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].externalId).toBe("/blog/post-1");
    expect(rows[1].externalId).toBe("/blog/post-2");
    expect(rows[2].externalId).toBe("/blog/post-3");
  });

  // REQ-004: sourceType matches config value
  it("sets sourceType from the source config", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([makeSource({ sourceType: "rss" })]),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].sourceType).toBe("rss");
  });

  // REQ-005: CollectorResult has correct fields
  it("returns CollectorResult with correct itemsFetched, commentsFetched, itemsStored, durationMs", async () => {
    const mockFetch = createMockFetch([
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(result.itemsFetched).toBe(3);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // REQ-006: 1000ms delay between article fetches
  it("enforces >= 1000ms delay between consecutive article page fetches", async () => {
    const timestamps: number[] = [];
    let callIndex = 0;
    const responses = [
      htmlResponse(indexHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ];
    const mockFetch = vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>().mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      if (callIndex > 1) {
        timestamps.push(Date.now());
      }
      return Promise.resolve({
        ok: resp.ok,
        status: resp.status,
        text: () => Promise.resolve(resp.body),
      });
    });
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch as MockFetchFn }, makeConfig());

    // timestamps[0] is first article fetch, timestamps[1] second, etc.
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(990);
    }
  });

  // REQ-007: 500ms delay between sources
  it("enforces >= 500ms delay between processing consecutive sources", async () => {
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/only">Only</a></div></body></html>`;
    const source1 = makeSource({ name: "Blog 1", indexUrl: "https://blog1.com" });
    const source2 = makeSource({ name: "Blog 2", indexUrl: "https://blog2.com" });

    const allTimestamps: number[] = [];
    let callIndex = 0;
    const responses = [
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ];
    const mockFetch = vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>().mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      allTimestamps.push(Date.now());
      return Promise.resolve({
        ok: resp.ok,
        status: resp.status,
        text: () => Promise.resolve(resp.body),
      });
    });
    const rawItemsRepo = createMockRepo();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch as MockFetchFn },
      makeConfig([source1, source2]),
    );

    // calls: [0]=source1 index, [1]=source1 article, [2]=source2 index, [3]=source2 article
    expect(allTimestamps).toHaveLength(4);
    // Gap between last source1 fetch (article) and first source2 fetch (index) should be >= 500ms
    const gap = allTimestamps[2] - allTimestamps[1];
    expect(gap).toBeGreaterThanOrEqual(490);
  });

  // REQ-008: Retry on 5xx/429 up to 3 times
  it("retries on 502 up to 3 times for index page fetch", async () => {
    const mockFetch = createMockFetch([
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();

    // Should not throw — index page failure is logged and skipped (REQ-010)
    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    // 3 retries for the index page
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.itemsFetched).toBe(0);
  });

  // REQ-009: No retry on 404
  it("does not retry on 404 and skips the URL", async () => {
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/missing">Missing</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      errorResponse(404),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    // 1 call for index, 1 call for article (no retry)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.itemsFetched).toBe(0);
  });

  // REQ-010: Failed index page skips to next source
  it("skips source with failed index page and continues to next source", async () => {
    const source1 = makeSource({ name: "Failing Blog", indexUrl: "https://failing.com" });
    const source2 = makeSource({ name: "Working Blog", indexUrl: "https://working.com" });
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/good">Good</a></div></body></html>`;

    const mockFetch = createMockFetch([
      // source1: 3 retries all fail
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      // source2: success
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([source1, source2]),
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.itemsStored).toBe(1);
  });

  // REQ-011: Failed article skips to next article
  it("skips failed article and continues to next article", { timeout: 30000 }, async () => {
    const threeLinks = `<html><body><div class="posts">
      <a href="/blog/a1">A1</a>
      <a href="/blog/a2">A2</a>
      <a href="/blog/a3">A3</a>
    </div></body></html>`;

    const mockFetch = createMockFetch([
      htmlResponse(threeLinks),
      htmlResponse(articleHtml),        // a1 - success
      errorResponse(500),               // a2 - fail
      errorResponse(500),               // a2 - retry 2
      errorResponse(500),               // a2 - retry 3
      htmlResponse(articleHtml),        // a3 - success
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(result.itemsFetched).toBe(2);
  });

  // REQ-012: Default engagement and metadata values
  it("sets engagement to {points:0,commentCount:0} and metadata to {comments:[]} for all items", async () => {
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/p1">P1</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].engagement).toEqual({ points: 0, commentCount: 0 });
    expect(rows[0].metadata).toEqual({ comments: [] });
  });

  // REQ-013: maxItems limits articles fetched
  it("limits articles fetched to maxItems", async () => {
    const manyLinks = `<html><body><div class="posts">
      <a href="/blog/p1">P1</a>
      <a href="/blog/p2">P2</a>
      <a href="/blog/p3">P3</a>
      <a href="/blog/p4">P4</a>
      <a href="/blog/p5">P5</a>
    </div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(manyLinks),
      htmlResponse(articleHtml),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([makeSource({ maxItems: 2 })]),
    );

    expect(result.itemsFetched).toBe(2);
    // 1 index + 2 article fetches
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // REQ-014: Relative URLs resolved against index base
  it("resolves relative URLs against the source indexUrl base", async () => {
    const relativeIndex = `<html><body><div class="posts"><a href="/blog/relative-post">Rel</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(relativeIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    // Second call should be the resolved absolute URL
    expect(mockFetch.mock.calls[1][0]).toBe("https://example.com/blog/relative-post");
  });

  // REQ-015: Articles without title are skipped
  it("skips articles where title selector matches nothing", async () => {
    const noTitleArticle = `<html><body><div class="content"><p>Content only</p></div></body></html>`;
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/no-title">NoTitle</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      htmlResponse(noTitleArticle),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(result.itemsFetched).toBe(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-016: Duplicate article links are deduplicated
  it("deduplicates article URLs before fetching", async () => {
    const dupeIndex = `<html><body><div class="posts">
      <a href="/blog/same">Same</a>
      <a href="/blog/same">Same</a>
      <a href="/blog/same">Same</a>
    </div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(dupeIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    // Only 1 index + 1 article fetch (not 3)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.itemsFetched).toBe(1);
  });

  // EDGE-001: Article link selector matches nothing
  it("handles index page where article link selector matches zero elements", async () => {
    const emptyIndex = `<html><body><div class="posts"></div></body></html>`;
    const mockFetch = createMockFetch([htmlResponse(emptyIndex)]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  // EDGE-002: Absolute external URL used as-is
  it("fetches absolute external URLs as-is without rewriting", async () => {
    const externalLinkIndex = `<html><body><div class="posts"><a href="https://external.com/article">External</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(externalLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(mockFetch.mock.calls[1][0]).toBe("https://external.com/article");
  });

  // EDGE-003: Title present but empty content
  it("collects item with title but empty content", async () => {
    const emptyContentArticle = `<html><body><h1 class="title">Has Title</h1><div class="content"></div></body></html>`;
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/empty-content">E</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      htmlResponse(emptyContentArticle),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(result.itemsFetched).toBe(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].title).toBe("Has Title");
    expect(rows[0].content).toBe("");
  });

  // EDGE-004: Empty sources array
  it("returns zero results for empty sources array without errors", async () => {
    const mockFetch = createMockFetch([]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([]),
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // EDGE-005: Same pathname with different sourceTypes
  it("stores items with same pathname but different sourceTypes", async () => {
    const singleLinkIndex = `<html><body><div class="posts"><a href="/shared/path">Shared</a></div></body></html>`;
    const source1 = makeSource({ name: "Blog", sourceType: "blog", indexUrl: "https://blog.com" });
    const source2 = makeSource({ name: "RSS", sourceType: "rss", indexUrl: "https://rss.com" });
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([source1, source2]),
    );

    // upsertItems called once per source
    const allRows = rawItemsRepo.upsertItems.mock.calls.flatMap((c) => c[0]);
    expect(allRows).toHaveLength(2);
    expect(allRows[0].sourceType).toBe("blog");
    expect(allRows[1].sourceType).toBe("rss");
    expect(allRows[0].externalId).toBe(allRows[1].externalId);
  });

  // EDGE-006: Network timeout on index fetch
  it("retries on network error for index fetch and skips source after exhaustion", async () => {
    const networkError = new Error("Network timeout");
    const mockFetch = vi.fn<[url: string, init?: RequestInit], Promise<MockResponse>>()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch as MockFetchFn },
      makeConfig(),
    );

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.itemsFetched).toBe(0);
  });

  // EDGE-007: URL with query params and fragments — pathname only
  it("strips query parameters and fragments from externalId", async () => {
    const queryIndex = `<html><body><div class="posts"><a href="/blog/post?utm=123#section">Link</a></div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(queryIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].externalId).toBe("/blog/post");
  });

  // EDGE-008: maxItems: 0 skips source
  it("fetches no articles when maxItems is 0", async () => {
    const mockFetch = createMockFetch([htmlResponse(indexHtml)]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([makeSource({ maxItems: 0 })]),
    );

    // Only the index page fetch, no article fetches
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.itemsFetched).toBe(0);
  });

  // EDGE-009: All article fetches fail for one source
  it("returns 0 items when all article fetches fail", { timeout: 30000 }, async () => {
    const twoLinks = `<html><body><div class="posts">
      <a href="/blog/f1">F1</a>
      <a href="/blog/f2">F2</a>
    </div></body></html>`;
    const mockFetch = createMockFetch([
      htmlResponse(twoLinks),
      // f1: 3 retries
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      // f2: 3 retries
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectWeb({ rawItemsRepo, fetchFn: mockFetch }, makeConfig());

    expect(result.itemsFetched).toBe(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  // EDGE-010: Missing author/date selectors -> null fields
  it("sets author and publishedAt to null when selectors are not provided", async () => {
    const singleLinkIndex = `<html><body><div class="posts"><a href="/blog/no-meta">NM</a></div></body></html>`;
    const noMetaSource = makeSource({
      selectors: {
        articleLink: ".posts a",
        title: "h1.title",
        content: "div.content",
        // no author or date selectors
      },
    });
    const mockFetch = createMockFetch([
      htmlResponse(singleLinkIndex),
      htmlResponse(articleHtml),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectWeb(
      { rawItemsRepo, fetchFn: mockFetch },
      makeConfig([noMetaSource]),
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].author).toBeNull();
    expect(rows[0].publishedAt).toBeNull();
  });
});
