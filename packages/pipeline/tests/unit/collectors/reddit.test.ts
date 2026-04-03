import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import redditListingFixture from "@pipeline-tests/unit/fixtures/reddit-listing.json";
import redditCommentsFixture from "@pipeline-tests/unit/fixtures/reddit-comments.json";

const SINGLE_SUB: RedditCollectConfig = { subreddits: ["MachineLearning"] };

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

function listingResponse(body: unknown = redditListingFixture): { ok: boolean; status: number; body: unknown } {
  return { ok: true, status: 200, body };
}

function commentsResponse(body: unknown = redditCommentsFixture): { ok: boolean; status: number; body: unknown } {
  return { ok: true, status: 200, body };
}

function errorResponse(status: number): { ok: boolean; status: number; body: unknown } {
  return { ok: false, status, body: "<html>Error</html>" };
}

type CollectRedditFn = (deps: { rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn }; fetchFn: MockFetchFn }, sourceId: number | null, config: RedditCollectConfig) => Promise<CollectorResult>;

describe("collectReddit", () => {
  let collectReddit: CollectRedditFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await import("@pipeline/collectors/reddit.js");
    collectReddit = mod.collectReddit as CollectRedditFn;
  });

  it("builds Reddit URL with default config", async () => {
    const mockFetch = createMockFetch([
      listingResponse({ kind: "Listing", data: { children: [] } }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("https://www.reddit.com/r/MachineLearning/");
    expect(url).toContain("top");
    expect(url).toContain("t=day");
    expect(url).toContain("limit=25");
  });

  it("builds URL with custom subreddits and sort", async () => {
    const mockFetch = createMockFetch([
      listingResponse({ kind: "Listing", data: { children: [] } }),
      listingResponse({ kind: "Listing", data: { children: [] } }),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      null,
      { subreddits: ["LocalLLaMA", "OpenAI"], sort: "hot", timeframe: "week", limit: 10 },
    );

    const url1 = mockFetch.mock.calls[0][0];
    expect(url1).toContain("/r/LocalLLaMA/hot.json");
    expect(url1).toContain("t=week");
    expect(url1).toContain("limit=10");

    const url2 = mockFetch.mock.calls[1][0];
    expect(url2).toContain("/r/OpenAI/hot.json");
  });

  it("parses listing items extracting title, url, externalId, author, publishedAt, engagement", async () => {
    const mockFetch = createMockFetch([
      listingResponse(),
      commentsResponse(),
      commentsResponse({ ...redditCommentsFixture, 1: { kind: "Listing", data: { children: [] } } }),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    // Fixture has 3 posts, but post003 is stickied so only 2 are parsed
    expect(result.itemsFetched).toBe(2);
    expect(result.itemsStored).toBe(2);

    expect(rawItemsRepo.upsertItems).toHaveBeenCalledTimes(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows).toHaveLength(2);

    const firstItem = rows[0];
    expect(firstItem.title).toBe("New open-source LLM beats GPT-4 on benchmarks");
    expect(firstItem.url).toBe("https://example.com/new-llm");
    expect(firstItem.externalId).toBe("post001");
    expect(firstItem.author).toBe("ml_researcher");
    expect(firstItem.sourceType).toBe("reddit");
    expect(firstItem.sourceUrl).toBe("https://www.reddit.com/r/MachineLearning/comments/post001/new_opensource_llm/");
    expect(firstItem.engagement).toEqual({ points: 1542, commentCount: 234 });
    expect(firstItem.publishedAt).toBeInstanceOf(Date);
  });

  it("filters out stickied posts", async () => {
    const mockFetch = createMockFetch([
      listingResponse(),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    // post003 is stickied, should be excluded
    expect(result.itemsFetched).toBe(2);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const externalIds = rows.map((r) => r.externalId);
    expect(externalIds).not.toContain("post003");
    expect(externalIds).toContain("post001");
    expect(externalIds).toContain("post002");
  });

  it("skips items missing title", async () => {
    const malformedListing = {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              ...redditListingFixture.data.children[0].data,
              title: "",
            },
          },
          redditListingFixture.data.children[1],
        ],
      },
    };
    const mockFetch = createMockFetch([
      listingResponse(malformedListing),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    // Only post002 should remain (post001 has empty title)
    expect(result.itemsFetched).toBe(1);
  });

  it("defaults engagement to 0 for missing score/num_comments", async () => {
    const noEngagementListing = {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              ...redditListingFixture.data.children[0].data,
              score: undefined,
              num_comments: undefined,
            },
          },
        ],
      },
    };
    const mockFetch = createMockFetch([
      listingResponse(noEngagementListing),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].engagement).toEqual({ points: undefined, commentCount: undefined });
  });

  it("fetches comments and attaches them to items", async () => {
    const singleItemListing = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[0]] },
    };
    const mockFetch = createMockFetch([
      listingResponse(singleItemListing),
      commentsResponse(),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    expect(result.commentsFetched).toBe(2);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata as { comments: { author: string; id: string; content: string }[] };
    expect(metadata.comments).toHaveLength(2);
    expect(metadata.comments[0].author).toBe("deep_learner");
    expect(metadata.comments[0].id).toBe("comment001");
    expect(metadata.comments[0].content).toBe("The benchmark methodology looks solid. Interesting that it outperforms on reasoning tasks.");
  });

  it("stores item without comments when comment fetch fails", async () => {
    const singleItemListing = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[0]] },
    };
    const mockFetch = createMockFetch([
      listingResponse(singleItemListing),
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const metadata = rows[0].metadata as { comments: unknown[] };
    expect(metadata.comments).toEqual([]);
  });

  it("retries on 502 up to 3 times", async () => {
    const mockFetch = createMockFetch([
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
    ]);
    const rawItemsRepo = createMockRepo();

    // Listing fetch fails after 3 retries; collectReddit catches per-subreddit errors
    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.itemsFetched).toBe(0);
  });

  it("enforces 500ms+ delay between consecutive requests", async () => {
    const twoItemListing = {
      kind: "Listing",
      data: {
        children: [
          redditListingFixture.data.children[0],
          redditListingFixture.data.children[1],
        ],
      },
    };
    const timestamps: number[] = [];
    const mockFetchFn = vi.fn().mockImplementation((url: string) => {
      timestamps.push(Date.now());
      if (url.includes("/top.json") || url.includes("/hot.json") || url.includes("/new.json")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(twoItemListing),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          redditCommentsFixture[0],
          { kind: "Listing", data: { children: [] } },
        ]),
      });
    });
    const rawItemsRepo = createMockRepo();

    await collectReddit({ rawItemsRepo, fetchFn: mockFetchFn }, null, SINGLE_SUB);

    // There should be delays between comment fetches (index 1 onward)
    for (let i = 2; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(490);
    }
  });

  it("handles empty listing with 0 items", async () => {
    const emptyListing = { kind: "Listing", data: { children: [] } };
    const mockFetch = createMockFetch([
      listingResponse(emptyListing),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    expect(result.itemsFetched).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  it("calls upsertItems with correct row shape", async () => {
    const singleItemListing = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[0]] },
    };
    const mockFetch = createMockFetch([
      listingResponse(singleItemListing),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    expect(rawItemsRepo.upsertItems).toHaveBeenCalledTimes(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("sourceType", "reddit");
    expect(rows[0]).toHaveProperty("externalId");
    expect(rows[0]).toHaveProperty("title");
    expect(rows[0]).toHaveProperty("url");
    expect(rows[0]).toHaveProperty("sourceUrl");
    expect(rows[0]).toHaveProperty("author");
    expect(rows[0]).toHaveProperty("engagement");
    expect(rows[0]).toHaveProperty("metadata");
    expect(rows[0]).toHaveProperty("publishedAt");
    expect(rows[0]).toHaveProperty("collectedAt");
  });

  it("returns CollectorResult with all metric fields", async () => {
    const mockFetch = createMockFetch([
      listingResponse(),
      commentsResponse(),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    expect(result).toHaveProperty("itemsFetched");
    expect(result).toHaveProperty("commentsFetched");
    expect(result).toHaveProperty("itemsStored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.durationMs).toBe("number");
  });

  it("deduplicates items across multiple subreddits", async () => {
    // Same post (post001) appears in both subreddits
    const listing1 = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[0]] },
    };
    const listing2 = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[0]] },
    };
    const mockFetch = createMockFetch([
      listingResponse(listing1),
      listingResponse(listing2),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      null,
      { subreddits: ["MachineLearning", "LocalLLaMA"] },
    );

    // post001 appears in both subs, should only be stored once
    expect(result.itemsFetched).toBe(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows).toHaveLength(1);
  });

  it("handles self-posts using permalink as url and selftext as content", async () => {
    // post002 is a self-post
    const selfPostListing = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[1]] },
    };
    const mockFetch = createMockFetch([
      listingResponse(selfPostListing),
      commentsResponse([redditCommentsFixture[0], { kind: "Listing", data: { children: [] } }]),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    const selfPost = rows[0];
    // Self-posts use reddit permalink as the URL
    expect(selfPost.url).toContain("reddit.com");
    expect(selfPost.url).toContain("post002");
    // Content should be the selftext
    expect(selfPost.content).toContain("experimenting with different local LLM setups");
  });

  it("sets User-Agent header on every request", async () => {
    const singleItemListing = {
      kind: "Listing",
      data: { children: [redditListingFixture.data.children[0]] },
    };
    const mockFetch = createMockFetch([
      listingResponse(singleItemListing),
      commentsResponse(),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit({ rawItemsRepo, fetchFn: mockFetch }, null, SINGLE_SUB);

    // Check that every call includes User-Agent header
    for (const call of mockFetch.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init).toBeDefined();
      const headers = init?.headers as Record<string, string>;
      expect(headers["User-Agent"]).toContain("NewsletterBot/1.0");
    }
  });
});
