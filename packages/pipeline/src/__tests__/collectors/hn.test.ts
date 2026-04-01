import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult, HnCollectConfig } from "@newsletter/shared/types";
import hnFeedFixture from "../fixtures/hn-feed.json";
import hnCommentsFixture from "../fixtures/hn-comments.json";

interface MockDb {
  insert: ReturnType<typeof vi.fn>;
}

function createMockDb(): MockDb {
  const onConflictDoUpdate = vi.fn().mockResolvedValue([{ count: 1 }]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert };
}

function createMockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
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

describe("collectHn", () => {
  let collectHn: (deps: { db: MockDb; fetchFn: ReturnType<typeof vi.fn> }, config: HnCollectConfig) => Promise<CollectorResult>;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import("../../collectors/hn.js");
    collectHn = mod.collectHn as typeof collectHn;
  });

  // REQ-002, REQ-010: URL construction with default config
  it("builds the hnrss.org URL with default keywords and threshold", async () => {
    const mockFetch = createMockFetch([
      feedResponse({ ...hnFeedFixture, items: [] }),
    ]);
    const db = createMockDb();

    await collectHn({ db, fetchFn: mockFetch }, {});

    const url = mockFetch.mock.calls[0][0] as string;
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
    const db = createMockDb();

    await collectHn(
      { db, fetchFn: mockFetch },
      { keywords: ["Rust", "Zig"], pointsThreshold: 50, count: 25 },
    );

    const url = mockFetch.mock.calls[0][0] as string;
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
    const db = createMockDb();

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result.itemsFetched).toBe(3);
    expect(result.itemsStored).toBe(3);

    const insertCall = db.insert.mock.calls[0];
    expect(insertCall).toBeDefined();

    const valuesCall = db.insert.mock.results[0].value.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(valuesCall).toHaveLength(3);

    const firstItem = valuesCall[0];
    expect(firstItem["title"]).toBe("Show HN: An open-source AI agent framework");
    expect(firstItem["url"]).toBe("https://example.com/ai-agent-framework");
    expect(firstItem["externalId"]).toBe("40001111");
    expect(firstItem["author"]).toBe("alice");
    expect(firstItem["sourceType"]).toBe("hn");
    expect(firstItem["sourceUrl"]).toBe("https://news.ycombinator.com/item?id=40001111");
    expect(firstItem["engagement"]).toEqual({ points: 142, commentCount: 37 });
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
    const db = createMockDb();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result.itemsFetched).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
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
    const db = createMockDb();

    await collectHn({ db, fetchFn: mockFetch }, {});

    const valuesCall = db.insert.mock.results[0].value.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(valuesCall[0]["engagement"]).toEqual({ points: 0, commentCount: 0 });
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
    const db = createMockDb();

    await collectHn({ db, fetchFn: mockFetch }, {});

    const valuesCall = db.insert.mock.results[0].value.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(valuesCall[0]["externalId"]).toBe("99999");
  });

  // EDGE-010: Unparseable HN ID is skipped
  it("skips items with unparseable HN ID and logs warning", async () => {
    const badIdFeed = {
      ...hnFeedFixture,
      items: [
        { ...hnFeedFixture.items[0], id: "https://example.com/no-id-here" },
      ],
    };
    const mockFetch = createMockFetch([
      feedResponse(badIdFeed),
    ]);
    const db = createMockDb();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result.itemsFetched).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // REQ-005: Comment fetching attaches comments to items
  it("fetches comments and attaches them to items", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse(),
    ]);
    const db = createMockDb();

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result.commentsFetched).toBe(2);
    const valuesCall = db.insert.mock.results[0].value.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    const metadata = valuesCall[0]["metadata"] as { comments: Array<{ author: string; content: string; publishedAt: string }> };
    expect(metadata.comments).toHaveLength(2);
    expect(metadata.comments[0].author).toBe("dave");
  });

  // EDGE-004: Comment fetch failure stores item without comments
  it("stores item without comments when comment fetch fails", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      errorResponse(502),
    ]);
    const db = createMockDb();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    const valuesCall = db.insert.mock.results[0].value.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    const metadata = valuesCall[0]["metadata"] as { comments: unknown[] };
    expect(metadata.comments).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // REQ-013, EDGE-001: Retry on 502
  it("retries on 502 up to 3 times for the main feed fetch", async () => {
    const mockFetch = createMockFetch([
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
    ]);
    const db = createMockDb();

    await expect(
      collectHn({ db, fetchFn: mockFetch }, {}),
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
    const db = createMockDb();

    await expect(
      collectHn({ db, fetchFn }, {}),
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
      if (url.includes("newest.jsonfeed")) {
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
    const db = createMockDb();

    await collectHn({ db, fetchFn: mockFetchFn }, {});

    // First call is the feed fetch, subsequent are comment fetches
    // Check gap between comment fetches (index 1 and 2)
    for (let i = 2; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(490); // Allow small timing variance
    }
  });

  // EDGE-009: Empty feed returns success with 0 items
  it("handles empty feed with 0 items", async () => {
    const emptyFeed = { ...hnFeedFixture, items: [] };
    const mockFetch = createMockFetch([
      feedResponse(emptyFeed),
    ]);
    const db = createMockDb();

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result.itemsFetched).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  // REQ-007, EDGE-005: DB upsert with correct shape
  it("calls db.insert with rawItems and onConflictDoUpdate", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse({ ...hnCommentsFixture, items: [] }),
    ]);
    const db = createMockDb();

    await collectHn({ db, fetchFn: mockFetch }, {});

    expect(db.insert).toHaveBeenCalledTimes(1);
    const valuesReturn = db.insert.mock.results[0].value;
    expect(valuesReturn.values).toHaveBeenCalledTimes(1);
    expect(valuesReturn.values.mock.results[0].value.onConflictDoUpdate).toHaveBeenCalledTimes(1);

    const upsertArg = valuesReturn.values.mock.results[0].value.onConflictDoUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(upsertArg).toHaveProperty("target");
    expect(upsertArg).toHaveProperty("set");
  });

  // EDGE-003: Item with 0 comments stores empty array
  it("stores empty comments array for item with no comments", async () => {
    const singleItemFeed = { ...hnFeedFixture, items: [hnFeedFixture.items[0]] };
    const emptyComments = { ...hnCommentsFixture, items: [] };
    const mockFetch = createMockFetch([
      feedResponse(singleItemFeed),
      commentsResponse(emptyComments),
    ]);
    const db = createMockDb();

    await collectHn({ db, fetchFn: mockFetch }, {});

    const valuesCall = db.insert.mock.results[0].value.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    const metadata = valuesCall[0]["metadata"] as { comments: unknown[] };
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
    const db = createMockDb();

    const result = await collectHn({ db, fetchFn: mockFetch }, {});

    expect(result).toHaveProperty("itemsFetched");
    expect(result).toHaveProperty("commentsFetched");
    expect(result).toHaveProperty("itemsStored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.durationMs).toBe("number");
  });
});
