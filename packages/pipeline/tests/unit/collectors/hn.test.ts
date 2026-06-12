import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig } from "@pipeline/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import hnAlgoliaStoriesFixture from "@pipeline-tests/unit/fixtures/hn-algolia-stories.json";
import hnAlgoliaCommentsFixture from "@pipeline-tests/unit/fixtures/hn-algolia-comments.json";

const emptyAlgoliaResponse = { hits: [], nbHits: 0 };

const warnSpy = vi.fn<[obj: unknown, msg?: string], undefined>();
vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: (obj: unknown, msg?: string) => undefined;
    warn: (obj: unknown, msg?: string) => undefined;
    error: (obj: unknown, msg?: string) => undefined;
    debug: (obj: unknown, msg?: string) => undefined;
  } => ({
    info: () => undefined,
    warn: (obj: unknown, msg?: string): undefined => {
      warnSpy(obj, msg);
      return undefined;
    },
    error: () => undefined,
    debug: () => undefined,
  }),
}));

const SINGLE_FEED: HnCollectConfig = { feeds: ["newest"] };

type MockUpsertFn = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsertFn } {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

type MockFetchFn = ReturnType<typeof vi.fn<[url: string, init?: RequestInit], Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>>;

interface MockResponse {
  ok: boolean;
  status: number;
  body: unknown;
  text?: string;
  headers?: Record<string, string>;
}

function createMockFetch(responses: MockResponse[]): MockFetchFn {
  let callIndex = 0;
  return vi.fn<[url: string, init?: RequestInit], Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string>; headers: { get: (name: string) => string | null } }>>().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    if (!resp) {
      return Promise.reject(new Error("Network error"));
    }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(resp.text ?? ""),
      headers: {
        get: (name: string): string | null => resp.headers?.[name.toLowerCase()] ?? null,
      },
    });
  });
}

function storiesResponse(body: unknown = hnAlgoliaStoriesFixture): MockResponse {
  return { ok: true, status: 200, body };
}

function commentsResponse(body: unknown = hnAlgoliaCommentsFixture): MockResponse {
  return { ok: true, status: 200, body };
}

function errorResponse(status: number): MockResponse {
  return { ok: false, status, body: "<html>Error</html>" };
}

type CollectHnFn = (deps: { rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn }; fetchFn: MockFetchFn }, config: HnCollectConfig) => Promise<CollectorResult>;

describe("collectHn", () => {
  let collectHn: CollectHnFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    warnSpy.mockClear();
    const mod = await import("@pipeline/collectors/hn.js");
    // Mock types are runtime-compatible but structurally incompatible with Drizzle chain types
    collectHn = mod.collectHn as CollectHnFn;
  });

  // REQ-002, REQ-010: URL construction with default config
  it("builds the Algolia search_by_date URL with default keywords and threshold", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("https://hn.algolia.com/api/v1/search_by_date");
    expect(url).toContain("tags=story");
    expect(url).toContain("numericFilters=points");
    expect(decodeURIComponent(url)).toContain("points>20");
    expect(url).toContain("hitsPerPage=100");
    // URLSearchParams encodes spaces as '+', so normalize before string-matching
    const decoded = decodeURIComponent(url).replace(/\+/g, " ");
    expect(decoded).toContain("AI");
    expect(decoded).toContain("LLM");
    expect(decoded).toContain("GPT");
    expect(decoded).toContain('"machine learning"');
  });

  // REQ-002, REQ-010, REQ-011: URL construction with custom config
  it("builds URL with custom keywords and threshold", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn(
      { rawItemsRepo, fetchFn: mockFetch },
      { keywords: ["Rust", "Zig"], pointsThreshold: 50, count: 25, feeds: ["newest"] },
    );

    const url = mockFetch.mock.calls[0][0];
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("points>50");
    expect(url).toContain("hitsPerPage=25");
    expect(decoded).toContain("Rust");
    expect(decoded).toContain("Zig");
  });

  // "best" feed maps to /search (relevance), "newest" maps to /search_by_date
  it("uses /search endpoint for best feed and /search_by_date for newest feed", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, { feeds: ["newest", "best"] });

    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/search_by_date");
    expect(mockFetch.mock.calls[1][0]).toContain("/api/v1/search?");
    expect(mockFetch.mock.calls[1][0]).not.toContain("/search_by_date");
  });

  // REQ-003, REQ-004: Story parsing with valid fixture
  it("parses Algolia hits extracting title, url, externalId, author, publishedAt, engagement", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(),
      commentsResponse(),
      commentsResponse(emptyAlgoliaResponse),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

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

  // EDGE-002: Hit missing title is skipped
  it("skips hits missing title", async () => {
    const malformed = {
      ...hnAlgoliaStoriesFixture,
      hits: [
        { ...hnAlgoliaStoriesFixture.hits[0], title: null },
        hnAlgoliaStoriesFixture.hits[1],
      ],
    };
    const mockFetch = createMockFetch([
      storiesResponse(malformed),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.itemsFetched).toBe(1);
  });

  // EDGE-006: Missing engagement data defaults to 0
  it("defaults engagement to 0 when points/num_comments are missing", async () => {
    const noEngagement = {
      ...hnAlgoliaStoriesFixture,
      hits: [
        { ...hnAlgoliaStoriesFixture.hits[0], points: null, num_comments: null },
      ],
    };
    const mockFetch = createMockFetch([
      storiesResponse(noEngagement),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].engagement).toEqual({ points: 0, commentCount: 0 });
  });

  // Algolia objectID is the HN story ID directly — no parsing needed
  it("uses Algolia objectID directly as externalId", async () => {
    const fixture = {
      ...hnAlgoliaStoriesFixture,
      hits: [
        { ...hnAlgoliaStoriesFixture.hits[0], objectID: "99999" },
      ],
    };
    const mockFetch = createMockFetch([
      storiesResponse(fixture),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].externalId).toBe("99999");
  });

  // Hits with missing objectID are skipped
  it("skips hits with missing objectID", async () => {
    const fixture = {
      ...hnAlgoliaStoriesFixture,
      hits: [
        { ...hnAlgoliaStoriesFixture.hits[0], objectID: "" },
      ],
    };
    const mockFetch = createMockFetch([
      storiesResponse(fixture),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.itemsFetched).toBe(0);
  });

  // Ask HN / Show HN self-posts have story_text and null url
  it("uses story_text as content and the HN permalink as url for self-posts", async () => {
    const askHn = {
      ...hnAlgoliaStoriesFixture,
      hits: [
        {
          ...hnAlgoliaStoriesFixture.hits[0],
          objectID: "55555555",
          title: "Ask HN: How do you handle prompt injection?",
          url: null,
          story_text: "I'm building an agent and wondering about defenses...",
        },
      ],
    };
    const mockFetch = createMockFetch([
      storiesResponse(askHn),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].url).toBe("https://news.ycombinator.com/item?id=55555555");
    expect(rows[0].content).toBe("I'm building an agent and wondering about defenses...");
  });

  // REQ-005: Comment fetching attaches comments with IDs
  it("fetches comments and attaches them to items with comment IDs", async () => {
    const singleHit = { ...hnAlgoliaStoriesFixture, hits: [hnAlgoliaStoriesFixture.hits[0]] };
    const mockFetch = createMockFetch([
      storiesResponse(singleHit),
      commentsResponse(),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.commentsFetched).toBe(2);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata;
    expect(metadata.comments).toHaveLength(2);
    expect(metadata.comments[0].author).toBe("dave");
    expect(metadata.comments[0].id).toBe("40001112");
  });

  // EDGE-004: Comment fetch failure stores item without comments
  it("stores item without comments when comment fetch fails", async () => {
    const singleHit = { ...hnAlgoliaStoriesFixture, hits: [hnAlgoliaStoriesFixture.hits[0]] };
    const mockFetch = createMockFetch([
      storiesResponse(singleHit),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata;
    expect(metadata.comments).toEqual([]);
  });

  // Comment fetch retries transient 502 and succeeds on a later attempt
  it("retries on 502 then succeeds for comment fetch", async () => {
    const singleHit = { ...hnAlgoliaStoriesFixture, hits: [hnAlgoliaStoriesFixture.hits[0]] };
    const mockFetch = createMockFetch([
      storiesResponse(singleHit),
      errorResponse(502),
      errorResponse(502),
      commentsResponse(),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.commentsFetched).toBe(2);
    // 1 story + 2 failed comment retries + 1 successful comment = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].metadata.comments).toHaveLength(2);
    expect(rows[0].metadata.comments[0].author).toBe("dave");
  });

  // Deleted/dead comments (null author or comment_text) are filtered out
  it("filters out deleted comments with null author or text", async () => {
    const singleHit = { ...hnAlgoliaStoriesFixture, hits: [hnAlgoliaStoriesFixture.hits[0]] };
    const mixedAlgoliaResponse = {
      hits: [
        {
          objectID: "50000001",
          author: null,
          comment_text: null,
          created_at: "2026-04-01T10:00:00Z",
          story_id: 40001111,
          parent_id: 40001111,
        },
        {
          objectID: "50000002",
          author: "frank",
          comment_text: "<p>Real comment here.</p>",
          created_at: "2026-04-01T10:05:00Z",
          story_id: 40001111,
          parent_id: 40001111,
        },
      ],
      nbHits: 2,
    };
    const mockFetch = createMockFetch([
      storiesResponse(singleHit),
      commentsResponse(mixedAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.commentsFetched).toBe(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].metadata.comments).toHaveLength(1);
    expect(rows[0].metadata.comments[0].id).toBe("50000002");
    expect(rows[0].metadata.comments[0].author).toBe("frank");
  });

  // REQ-013, EDGE-001: Retry on 502
  it("retries on 502 up to 3 times for the main story fetch", async () => {
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
      collectHn({ rawItemsRepo, fetchFn }, SINGLE_FEED),
    ).rejects.toThrow();

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  // REQ-006: Rate limiting between consecutive requests
  it("enforces 500ms+ delay between consecutive Algolia requests", async () => {
    const twoHit = {
      ...hnAlgoliaStoriesFixture,
      hits: [hnAlgoliaStoriesFixture.hits[0], hnAlgoliaStoriesFixture.hits[1]],
    };
    const algoliaTimestamps: number[] = [];
    const mockFetchFn = vi.fn().mockImplementation((url: string) => {
      const isAlgolia = url.includes("hn.algolia.com");
      if (isAlgolia) {
        algoliaTimestamps.push(Date.now());
      }
      if (url.includes("tags=story") && !url.includes("tags=comment")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(twoHit),
        });
      }
      if (isAlgolia) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(emptyAlgoliaResponse),
        });
      }
      // OG image fetch
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<html></html>"),
        headers: { get: () => "text/html" },
      });
    });
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetchFn }, SINGLE_FEED);

    for (let i = 2; i < algoliaTimestamps.length; i++) {
      const gap = algoliaTimestamps[i] - algoliaTimestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(490);
    }
  });

  // EDGE-009: Empty response returns success with 0 items
  it("handles empty Algolia response with 0 hits", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    expect(result.itemsFetched).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  // EDGE-003: Item with 0 comments stores empty array
  it("stores empty comments array for item with no comments", async () => {
    const singleHit = { ...hnAlgoliaStoriesFixture, hits: [hnAlgoliaStoriesFixture.hits[0]] };
    const mockFetch = createMockFetch([
      storiesResponse(singleHit),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata;
    expect(metadata.comments).toEqual([]);
  });


  // Multi-feed: fetches both newest and best, deduplicates
  it("fetches multiple feeds and deduplicates items by HN ID", async () => {
    const newestResp = {
      ...hnAlgoliaStoriesFixture,
      hits: [hnAlgoliaStoriesFixture.hits[0], hnAlgoliaStoriesFixture.hits[1]],
    };
    const bestResp = {
      ...hnAlgoliaStoriesFixture,
      hits: [hnAlgoliaStoriesFixture.hits[0], hnAlgoliaStoriesFixture.hits[2]],
    };
    const mockFetch = createMockFetch([
      storiesResponse(newestResp),
      storiesResponse(bestResp),
      commentsResponse(emptyAlgoliaResponse),
      commentsResponse(emptyAlgoliaResponse),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectHn({ rawItemsRepo, fetchFn: mockFetch }, { feeds: ["newest", "best"] });

    expect(result.itemsFetched).toBe(3);

    const firstUrl = mockFetch.mock.calls[0][0];
    const secondUrl = mockFetch.mock.calls[1][0];
    expect(firstUrl).toContain("/api/v1/search_by_date");
    expect(secondUrl).toContain("/api/v1/search?");
    expect(secondUrl).not.toContain("/search_by_date");
  });

  // Configurable comment count
  it("passes commentsPerItem count to comment fetch URL", async () => {
    const singleHit = { ...hnAlgoliaStoriesFixture, hits: [hnAlgoliaStoriesFixture.hits[0]] };
    const mockFetch = createMockFetch([
      storiesResponse(singleHit),
      commentsResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, { feeds: ["newest"], commentsPerItem: 50 });

    const commentUrl = mockFetch.mock.calls[1][0];
    expect(commentUrl).toContain("hn.algolia.com");
    expect(commentUrl).toContain("tags=comment,story_");
    expect(commentUrl).toContain("hitsPerPage=50");
  });

  // REQ-021: sinceDays is encoded as a server-side numericFilters created_at_i clause
  it("encodes sinceDays as a created_at_i numericFilter on the request URL", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    const before = Math.floor((Date.now() - 7 * 86_400_000) / 1000);
    await collectHn(
      { rawItemsRepo, fetchFn: mockFetch },
      { feeds: ["newest"], sinceDays: 7, commentsPerItem: 0 },
    );
    const after = Math.floor((Date.now() - 7 * 86_400_000) / 1000);

    const url = mockFetch.mock.calls[0][0];
    const decoded = decodeURIComponent(url);
    const match = /created_at_i>(\d+)/.exec(decoded);
    if (!match) {
      throw new Error("expected created_at_i in URL");
    }
    const cutoff = Number(match[1]);
    expect(cutoff).toBeGreaterThanOrEqual(before - 1);
    expect(cutoff).toBeLessThanOrEqual(after + 1);
  });

  // REQ-021: sinceDays undefined → no created_at_i clause in the URL
  it("does not include created_at_i filter when sinceDays is undefined", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectHn({ rawItemsRepo, fetchFn: mockFetch }, SINGLE_FEED);

    const url = mockFetch.mock.calls[0][0];
    expect(decodeURIComponent(url)).not.toContain("created_at_i");
  });

  // VER-73 follow-up: run-level AbortSignal must reach every inner fetch
  it("forwards the run-level AbortSignal to every fetch call", async () => {
    const mockFetch = createMockFetch([
      storiesResponse(emptyAlgoliaResponse),
    ]);
    const rawItemsRepo = createMockRepo();
    const controller = new AbortController();

    type CollectHnWithSignal = (
      deps: { rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn }; fetchFn: MockFetchFn; signal: AbortSignal },
      config: HnCollectConfig,
    ) => Promise<CollectorResult>;
    const collectHnWithSignal = collectHn as unknown as CollectHnWithSignal;

    await collectHnWithSignal(
      { rawItemsRepo, fetchFn: mockFetch, signal: controller.signal },
      SINGLE_FEED,
    );

    expect(mockFetch).toHaveBeenCalled();
    for (const call of mockFetch.mock.calls) {
      const init = call[1];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
    }

    controller.abort(new Error("cancelled"));
    for (const call of mockFetch.mock.calls) {
      expect(call[1]?.signal?.aborted).toBe(true);
    }
  });
});
