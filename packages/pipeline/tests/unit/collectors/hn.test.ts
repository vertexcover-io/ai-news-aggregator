import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig } from "@pipeline/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import hnFeedFixture from "@pipeline-tests/unit/fixtures/hn-feed.json";
import hnCommentsFixture from "@pipeline-tests/unit/fixtures/hn-comments.json";

const SINGLE_FEED: HnCollectConfig = { feeds: ["newest"] };

type MockUpsertFn = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsertFn } {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

type MockFetchFn = ReturnType<typeof vi.fn<[url: string, init?: RequestInit], Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>>;

function createMockFetch(responses: { ok: boolean; status: number; body: unknown }[]): MockFetchFn {
  let callIndex = 0;
  return vi.fn<[url: string, init?: RequestInit], Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    if (!resp) {
      return Promise.reject(new Error("Network error"));
    }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      json: () => Promise.resolve(resp.body),
    });
  });
}

function feedResponse(body: unknown = hnFeedFixture): { ok: boolean; status: number; body: unknown } {
  return { ok: true, status: 200, body };
}

function commentsResponse(body: unknown = hnCommentsFixture): { ok: boolean; status: number; body: unknown } {
  return { ok: true, status: 200, body };
}

function errorResponse(status: number): { ok: boolean; status: number; body: unknown } {
  return { ok: false, status, body: "<html>Error</html>" };
}

type CollectHnFn = (deps: { rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn }; fetchFn: MockFetchFn }, config: HnCollectConfig) => Promise<CollectorResult>;

describe("collectHn", () => {
  let collectHn: CollectHnFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import("@pipeline/collectors/hn.js");
    // Mock types are runtime-compatible but structurally incompatible with Drizzle chain types
    collectHn = mod.collectHn as CollectHnFn;
  });

  // REQ-002, REQ-010: URL construction with default config
  it("builds the hnrss.org URL with default keywords and threshold", async () => {
    const mockFetch = createMockFetch([
      feedResponse({ ...hnFeedFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("https://hnrss.org/newest.jsonfeed");
    expect(url).toContain("q=");
    expect(url).toContain("AI");
    expect(url).toContain("+OR+");
    expect(url).toContain("LLM");
    expect(url).toContain("points=20");
    expect(url).toContain("count=100");
  });

  // REQ-002, REQ-010, REQ-011: URL construction with custom config
  it("builds URL with custom keywords and threshold", async () => {
    const mockFetch = createMockFetch([
      feedResponse({ ...hnFeedFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn(
      { rawItemsRepo, fetchFn: mockFetch },
      { keywords: ["Rust", "Zig"], pointsThreshold: 50, count: 25, feeds: ["newest"] },
    );

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("q=Rust+OR+Zig");
    expect(url).toContain("points=50");
    expect(url).toContain("count=25");
  });

  // REQ-003, REQ-004: Feed parsing with valid fixture
  it("parses feed items extracting title, url, externalId, author, publishedAt, engagement", async () => {
    const mockFetch = createMockFetch([
      feedResponse(),
      commentsResponse(),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result.itemsFetched).toBe(3);
    expect(result.itemsStored).toBe(3);

    expect(rawItemsRepo.upsertItems).toHaveBeenCalledTimes(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows).toHaveLength(3);

    const firstItem = rows[0];
    expect(firstItem.title).toBe("Show HN: An open-source AI agent framework");
    expect(firstItem.url).toBe("https://example.com/ai-agent-framework");
    expect(firstItem.externalId).toBe("40001111");
    expect(firstItem.author).toBe("alice");
    expect(firstItem.sourceType).toBe("hn");
    expect(firstItem.sourceUrl).toBe("https://news.ycombinator.com/item?id=40001111");
    expect(firstItem.engagement).toEqual({ points: 142, commentCount: 37 });
  });

  // EDGE-002: Malformed item (missing title) is skipped
  it("skips items missing title and logs warning", async () => {
    const malformedFeed = {
      ...hnFeedFixture,
      items: [
        { ...hnFeedFixture.items[0], title: undefined },
        hnFeedFixture.items[1],
      ],
    };
    const mockFetch = createMockFetch([
      feedResponse(malformedFeed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result.itemsFetched).toBe(1);
  });

  // EDGE-006: Missing engagement data defaults to 0
  it("defaults engagement to 0 when missing from content_html", async () => {
    const noEngagementFeed = {
      ...hnFeedFixture,
      items: [
        { ...hnFeedFixture.items[0], content_html: "<p>No engagement info here</p>" },
      ],
    };
    const mockFetch = createMockFetch([
      feedResponse(noEngagementFeed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].engagement).toEqual({ points: 0, commentCount: 0 });
  });

  // EDGE-010: HN ID extraction from various URL formats
  it("extracts HN ID from item id field", async () => {
    const feed = {
      ...hnFeedFixture,
      items: [
        { ...hnFeedFixture.items[0], id: "https://news.ycombinator.com/item?id=99999" },
      ],
    };
    const mockFetch = createMockFetch([
      feedResponse(feed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].externalId).toBe("99999");
  });

  // EDGE-010: Unparseable HN ID is skipped
  it("skips items with unparseable HN ID", async () => {
    const badIdFeed = {
      ...hnFeedFixture,
      items: [
        { ...hnFeedFixture.items[0], id: "https://example.com/no-id-here" },
      ],
    };
    const mockFetch = createMockFetch([
      feedResponse(badIdFeed),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result.itemsFetched).toBe(0);
  });

  // REQ-005: Comment fetching attaches comments with IDs
  it("fetches comments and attaches them to items with comment IDs", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse(),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result.commentsFetched).toBe(2);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata;
    expect(metadata.comments).toHaveLength(2);
    expect(metadata.comments[0].author).toBe("dave");
    expect(metadata.comments[0].id).toBe("40001112");
  });

  // EDGE-004: Comment fetch failure stores item without comments
  it("stores item without comments when comment fetch fails", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata;
    expect(metadata.comments).toEqual([]);
  });

  // REQ-013, EDGE-001: Retry on 502
  it("retries on 502 up to 3 times for the main feed fetch", async () => {
    const mockFetch = createMockFetch([
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();

    await expect(
      collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // EDGE-007: JSON parse error treated as retryable
  it("retries on JSON parse error", async () => {
    const htmlResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(htmlResponse)
      .mockResolvedValueOnce(htmlResponse)
      .mockResolvedValueOnce(htmlResponse);
    const rawItemsRepo = createMockRepo();

    await expect(
      collectHn({ rawItemsRepo, fetchFn },SINGLE_FEED),
    ).rejects.toThrow();

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  // REQ-006: Rate limiting between requests
  it("enforces 500ms+ delay between consecutive requests", async () => {
    const twoItemFeed = {
      ...hnFeedFixture,
      items: [hnFeedFixture.items[0], hnFeedFixture.items[1]],
    };
    const timestamps: number[] = [];
    const mockFetchFn = vi.fn().mockImplementation((url: string) => {
      timestamps.push(Date.now());
      if (url.includes(".jsonfeed?q=")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(twoItemFeed),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...hnCommentsFixture, items: [] }),
      });
    });
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetchFn },SINGLE_FEED);

    for (let i = 2; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(490);
    }
  });

  // EDGE-009: Empty feed returns success with 0 items
  it("handles empty feed with 0 items", async () => {
    const emptyFeed = { ...hnFeedFixture, items: [] };
    const mockFetch = createMockFetch([
      feedResponse(emptyFeed),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result.itemsFetched).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-007, EDGE-005: DB upsert with correct shape
  it("calls upsertItems with correct row shape", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(rawItemsRepo.upsertItems).toHaveBeenCalledTimes(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("sourceType", "hn");
    expect(rows[0]).toHaveProperty("externalId");
    expect(rows[0]).toHaveProperty("engagement");
    expect(rows[0]).toHaveProperty("metadata");
  });

  // EDGE-003: Item with 0 comments stores empty array
  it("stores empty comments array for item with no comments", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const emptyComments = { ...hnCommentsFixture, items: [] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse(emptyComments),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata;
    expect(metadata.comments).toEqual([]);
  });

  // REQ-009: Return metrics
  it("returns CollectorResult with all metric fields", async () => {
    const mockFetch = createMockFetch([
      feedResponse(),
      commentsResponse(),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },SINGLE_FEED);

    expect(result).toHaveProperty("itemsFetched");
    expect(result).toHaveProperty("commentsFetched");
    expect(result).toHaveProperty("itemsStored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.durationMs).toBe("number");
  });

  // Multi-feed: fetches both newest and best, deduplicates
  it("fetches multiple feeds and deduplicates items by HN ID", async () => {
    const newestFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0], hnFeedFixture.items[1]] };
    const bestFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0], hnFeedFixture.items[2]] };
    const mockFetch = createMockFetch([
      feedResponse(newestFeed),
      feedResponse(bestFeed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch },{ feeds: ["newest", "best"] });

    expect(result.itemsFetched).toBe(3);

    const firstUrl = mockFetch.mock.calls[0][0];
    const secondUrl = mockFetch.mock.calls[1][0];
    expect(firstUrl).toContain("newest.jsonfeed");
    expect(secondUrl).toContain("best.jsonfeed");
  });

  // Configurable comment count
  it("passes commentsPerItem count to comment fetch URL", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch },{ feeds: ["newest"], commentsPerItem: 50 });

    const commentUrl = mockFetch.mock.calls[1][0];
    expect(commentUrl).toContain("count=50");
  });
});
