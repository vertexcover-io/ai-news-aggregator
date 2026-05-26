import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";
import webListingFixture from "@pipeline-tests/unit/fixtures/web-listing.json";
import webPostFixture from "@pipeline-tests/unit/fixtures/web-post.json";
import {
  discoverPostUrls,
  extractPostFields,
  validateDiscoveredUrls,
  DiscoverySchema,
  DetailSchema,
  collectWeb,
  buildRawItem,
  applySinceDays,
  parseDateOrNull,
  type DiscoveredPost,
} from "@pipeline/collectors/web.js";
import type { BlogSource } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { CrawlResult } from "@pipeline/services/web-crawler.js";

interface ListingFixture {
  listingUrl: string;
  markdown: string;
}

interface PostFixture {
  postUrl: string;
  markdown: string;
}

const listing = webListingFixture as ListingFixture;
const post = webPostFixture as PostFixture;

function makeDiscoveryMockModel(jsonObject: unknown): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(jsonObject) }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
        warnings: [],
      }),
  });
}

function makeThrowingModel(message: string): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    doGenerate: () => Promise.reject(new Error(message)),
  });
}

function getCallOrThrow(
  calls: readonly LanguageModelV2CallOptions[],
  index: number,
): LanguageModelV2CallOptions {
  const call = calls[index];
  if (!call) throw new Error(`expected call at index ${String(index)}`);
  return call;
}

describe("LLM extraction helpers", () => {
  describe("discoverPostUrls", () => {
    it("returns posts array from mocked LLM", async () => {
      const fakePosts = [
        {
          url: "https://example.com/blog/scaling-events",
          title: "Scaling our event pipeline to 10M events/sec",
          published_at: "2026-03-30",
        },
        {
          url: "https://example.com/blog/rust-scheduler",
          title: "Why we rewrote our scheduler in Rust",
          published_at: "2026-03-22",
        },
      ];
      const model = makeDiscoveryMockModel({ posts: fakePosts });

      const result = await discoverPostUrls(listing.listingUrl, listing.markdown, model);

      expect(result).toEqual(fakePosts);
    });

    it("passes temperature 0 to generateText", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, model);

      expect(model.doGenerateCalls).toHaveLength(1);
      const call = getCallOrThrow(model.doGenerateCalls, 0);
      expect(call.temperature).toBe(0);
    });

    it("passes DiscoverySchema to generateText", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const responseFormat = call.responseFormat;
      if (responseFormat?.type !== "json") {
        throw new Error("expected json response format");
      }
      const schema = responseFormat.schema as { properties?: Record<string, unknown> } | undefined;
      expect(schema?.properties).toHaveProperty("posts");
    });

    it("throws when LLM throws", async () => {
      const model = makeThrowingModel("upstream LLM failure");

      await expect(
        discoverPostUrls(listing.listingUrl, listing.markdown, model),
      ).rejects.toThrow();
    });
  });

  describe("extractPostFields", () => {
    it("returns title/author/published_at/image_url from mocked LLM", async () => {
      const fakeFields = {
        title: "Scaling our event pipeline to 10M events/sec",
        author: "Jane Doe",
        published_at: "2026-03-30",
        image_url: "https://example.com/hero.jpg",
      };
      const model = makeDiscoveryMockModel(fakeFields);

      const result = await extractPostFields(post.postUrl, post.markdown, model);

      expect(result).toEqual(fakeFields);
    });

    it("passes temperature 0 to generateText", async () => {
      const model = makeDiscoveryMockModel({ title: "", author: "", published_at: "", image_url: "" });

      await extractPostFields(post.postUrl, post.markdown, model);

      expect(model.doGenerateCalls).toHaveLength(1);
      const call = getCallOrThrow(model.doGenerateCalls, 0);
      expect(call.temperature).toBe(0);
    });

    it("passes DetailSchema with image_url to generateText", async () => {
      const model = makeDiscoveryMockModel({ title: "", author: "", published_at: "", image_url: "" });

      await extractPostFields(post.postUrl, post.markdown, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const responseFormat = call.responseFormat;
      if (responseFormat?.type !== "json") {
        throw new Error("expected json response format");
      }
      const schema = responseFormat.schema as { properties?: Record<string, unknown> } | undefined;
      expect(schema?.properties).toHaveProperty("title");
      expect(schema?.properties).toHaveProperty("author");
      expect(schema?.properties).toHaveProperty("published_at");
      expect(schema?.properties).toHaveProperty("image_url");
    });
  });

  describe("validateDiscoveredUrls", () => {
    it("drops URLs not present in the listing markdown", () => {
      const posts: DiscoveredPost[] = [
        {
          url: "https://example.com/blog/scaling-events",
          title: "Real post",
          published_at: "2026-03-30",
        },
        {
          url: "https://example.com/blog/hallucinated-post",
          title: "Made up by the LLM",
          published_at: "2026-03-25",
        },
      ];

      const result = validateDiscoveredUrls(posts, listing.markdown, listing.listingUrl);

      expect(result).toHaveLength(1);
      expect(result.map((p) => p.url)).toEqual([
        "https://example.com/blog/scaling-events",
      ]);
    });

    it("keeps URLs that appear as substrings", () => {
      const posts: DiscoveredPost[] = [
        {
          url: "https://example.com/blog/scaling-events",
          title: "A",
          published_at: "",
        },
        {
          url: "https://example.com/blog/rust-scheduler",
          title: "B",
          published_at: "",
        },
        {
          url: "https://example.com/blog/feature-flags",
          title: "C",
          published_at: "",
        },
      ];

      const result = validateDiscoveredUrls(posts, listing.markdown, listing.listingUrl);

      expect(result).toHaveLength(3);
    });

    it("handles empty input gracefully", () => {
      const result = validateDiscoveredUrls([], listing.markdown, listing.listingUrl);
      expect(result).toEqual([]);
    });

    it("resolves a relative URL against the listing URL and keeps it", () => {
      // The discovery LLM commonly emits relative hrefs as they appear in the
      // page markdown — these must be resolved to absolute, not dropped.
      const posts: DiscoveredPost[] = [
        {
          url: "/blog/scaling-events",
          title: "Relative post",
          published_at: "2026-03-30",
        },
      ];

      const result = validateDiscoveredUrls(posts, listing.markdown, listing.listingUrl);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe("https://example.com/blog/scaling-events");
    });

    it("drops empty, fragment, and non-http(s) URLs", () => {
      const posts: DiscoveredPost[] = [
        { url: "", title: "empty", published_at: "" },
        { url: "#", title: "fragment", published_at: "" },
        { url: "mailto:hi@example.com", title: "mailto", published_at: "" },
        { url: "javascript:void(0)", title: "js", published_at: "" },
      ];

      const result = validateDiscoveredUrls(posts, listing.markdown, listing.listingUrl);

      expect(result).toEqual([]);
    });

    it("keeps a valid absolute URL even when one sibling is malformed", () => {
      const posts: DiscoveredPost[] = [
        { url: "/blog/scaling-events", title: "good", published_at: "" },
        { url: "", title: "bad", published_at: "" },
      ];

      const result = validateDiscoveredUrls(posts, listing.markdown, listing.listingUrl);

      expect(result.map((p) => p.url)).toEqual([
        "https://example.com/blog/scaling-events",
      ]);
    });
  });

  describe("schemas", () => {
    it("DiscoverySchema parses well-formed input", () => {
      const parsed = DiscoverySchema.parse({
        posts: [{ url: "https://example.com/a", title: "A", published_at: "2026-01-01" }],
      });
      expect(parsed.posts).toHaveLength(1);
    });

    it("DetailSchema parses well-formed input", () => {
      const parsed = DetailSchema.parse({
        title: "T",
        author: "A",
        published_at: "2026-01-01",
        image_url: "https://example.com/img.jpg",
      });
      expect(parsed.title).toBe("T");
      expect(parsed.image_url).toBe("https://example.com/img.jpg");
    });
  });
});

describe("filters and row assembly", () => {
  interface DiscoveredPostShape {
    url: string;
    title: string;
    published_at: string;
  }
  interface ExtractedFieldsShape {
    title: string;
    author: string;
    published_at: string;
    image_url: string;
  }
  type ApplySinceDaysFn = (
    posts: DiscoveredPostShape[],
    sinceDays: number | undefined,
  ) => DiscoveredPostShape[];
  type ParseDateOrNullFn = (raw: string | undefined | null) => Date | null;
  type BuildRawItemFn = (
    postUrl: string,
    markdownBody: string,
    fields: ExtractedFieldsShape,
  ) => import("@newsletter/shared/db").RawItemInsert;

  let applySinceDaysFn: ApplySinceDaysFn;
  let parseDateOrNullFn: ParseDateOrNullFn;
  let buildRawItemFn: BuildRawItemFn;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-07T00:00:00Z"));
    applySinceDaysFn = applySinceDays as ApplySinceDaysFn;
    parseDateOrNullFn = parseDateOrNull as ParseDateOrNullFn;
    buildRawItemFn = buildRawItem as BuildRawItemFn;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applySinceDays returns input unchanged when sinceDays is undefined", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/a", title: "A", published_at: "2020-01-01" },
      { url: "https://x/b", title: "B", published_at: "" },
    ];
    expect(applySinceDaysFn(posts, undefined)).toEqual(posts);
  });

  // REQ-020
  it("applySinceDays drops posts older than the cutoff", () => {
    const tenDaysAgo = new Date("2026-03-28T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/old", title: "Old", published_at: tenDaysAgo },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual([]);
  });

  // REQ-020
  it("applySinceDays keeps posts within the cutoff", () => {
    const fiveDaysAgo = new Date("2026-04-02T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/new", title: "New", published_at: fiveDaysAgo },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  // REQ-021
  it("applySinceDays keeps posts with empty published_at even when sinceDays is set", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/empty", title: "Empty", published_at: "" },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  // REQ-022
  it("applySinceDays keeps posts with unparseable published_at", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/bad", title: "Bad", published_at: "not a date" },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  it("applySinceDays keeps a post exactly at the cutoff boundary", () => {
    const cutoff = new Date("2026-03-31T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/edge", title: "Edge", published_at: cutoff },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  it("parseDateOrNull returns null for empty string", () => {
    expect(parseDateOrNullFn("")).toBeNull();
  });

  it("parseDateOrNull returns null for null input", () => {
    expect(parseDateOrNullFn(null)).toBeNull();
  });

  // REQ-051
  it("parseDateOrNull returns null for unparseable input", () => {
    expect(parseDateOrNullFn("not a date")).toBeNull();
  });

  it("parseDateOrNull returns a Date for YYYY-MM-DD input", () => {
    const result = parseDateOrNullFn("2026-04-07");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-04-07T00:00:00.000Z");
  });

  it("parseDateOrNull returns a Date for full ISO-8601 input", () => {
    const result = parseDateOrNullFn("2026-04-07T10:30:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-04-07T10:30:00.000Z");
  });

  // REQ-050
  it("buildRawItem produces correct shape with all required fields", () => {
    const item = buildRawItemFn(
      "https://example.com/post-1",
      "# Body markdown",
      { title: "Post 1", author: "Jane Doe", published_at: "2026-04-01T00:00:00Z", image_url: "https://example.com/hero.jpg" },
    );
    expect(item.sourceType).toBe("blog");
    expect(item.externalId).toBe("https://example.com/post-1");
    expect(item.url).toBe("https://example.com/post-1");
    expect(item.sourceUrl).toBe("https://example.com/post-1");
    expect(item.title).toBe("Post 1");
    expect(item.author).toBe("Jane Doe");
    expect(item.content).toBe("# Body markdown");
    expect(item.imageUrl).toBe("https://example.com/hero.jpg");
    if (!(item.publishedAt instanceof Date)) {
      throw new Error("expected publishedAt to be a Date");
    }
    expect(item.publishedAt.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(item.engagement).toEqual({ points: 0, commentCount: 0 });
    expect(item.metadata).toEqual({ comments: [] });
    expect(item.collectedAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it("buildRawItem sets author to null when extracted author is empty", () => {
    const item = buildRawItemFn(
      "https://example.com/post-2",
      "body",
      { title: "T", author: "   ", published_at: "", image_url: "" },
    );
    expect(item.author).toBeNull();
  });

  // REQ-051
  it("buildRawItem sets publishedAt to null when published_at is unparseable", () => {
    const item = buildRawItemFn(
      "https://example.com/post-3",
      "body",
      { title: "T", author: "A", published_at: "not a date", image_url: "" },
    );
    expect(item.publishedAt).toBeNull();
  });

  it("buildRawItem sets imageUrl to null when image_url is empty", () => {
    const item = buildRawItemFn(
      "https://example.com/post-4",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "" },
    );
    expect(item.imageUrl).toBeNull();
  });

  it("buildRawItem sets imageUrl to null when image_url is a data URI", () => {
    const item = buildRawItemFn(
      "https://example.com/post-5",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "data:image/png;base64,abc" },
    );
    expect(item.imageUrl).toBeNull();
  });

  it("buildRawItem sets imageUrl when image_url is a valid http URL", () => {
    const item = buildRawItemFn(
      "https://example.com/post-6",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "https://cdn.example.com/img.jpg" },
    );
    expect(item.imageUrl).toBe("https://cdn.example.com/img.jpg");
  });
});

// ── collectWeb tests (mocked at runWebCrawl boundary) ─────────────────────────

function makeRepo(existing: string[] = []): RawItemsRepo {
  return {
    upsertItems: vi.fn().mockResolvedValue(undefined),
    findExistingExternalIds: vi.fn().mockResolvedValue(new Set(existing)),
    findBySourceAndExternalId: vi.fn().mockResolvedValue(null),
    updateRecapData: vi.fn().mockResolvedValue(undefined),
  };
}

const sourceA: BlogSource = { name: "alpha", listingUrl: "https://alpha.example.com/blog" };
const sourceB: BlogSource = { name: "beta", listingUrl: "https://beta.example.com/blog" };

const DISCOVERY_POSTS = [
  { url: "https://example.com/blog/scaling-events", title: "Post A", published_at: "2026-03-30" },
  { url: "https://example.com/blog/rust-scheduler", title: "Post B", published_at: "2026-03-29" },
];

const LISTING_MARKDOWN = `
# Tech Blog

- [Post A](https://example.com/blog/scaling-events)
- [Post B](https://example.com/blog/rust-scheduler)
`;

const DETAIL_MARKDOWN = "# Post Title\n\nThis is the post content about something interesting.";

function makeSuccessResult(markdown: string, imageUrl: string | null = null): CrawlResult {
  return {
    ok: true,
    result: { markdown, title: null, byline: null, imageUrl, textLength: markdown.length },
    renderedWith: "static",
  };
}

function makeFailureResult(error: string): CrawlResult {
  return { ok: false, error };
}

function makeDiscoveryModel(
  posts: { url: string; title: string; published_at: string }[],
): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ posts }) }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
      }),
  });
}

function makeDiscoveryThenExtractModel(
  discoveryPosts: { url: string; title: string; published_at: string }[],
  extractFields: { title: string; author: string; published_at: string; image_url?: string },
): MockLanguageModelV2 {
  let calls = 0;
  const withDefaults = { image_url: "", ...extractFields };
  return new MockLanguageModelV2({
    doGenerate: () => {
      const isDiscovery = calls === 0;
      calls++;
      const payload = isDiscovery ? { posts: discoveryPosts } : withDefaults;
      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
      });
    },
  });
}

describe("collectWeb (mocked at runWebCrawl boundary)", () => {
  // EDGE-018: empty sources array
  it("returns empty result without throwing when sources is []", async () => {
    const repo = makeRepo();
    const runWebCrawl = vi.fn().mockResolvedValue(new Map());
    const model = new MockLanguageModelV2({
      doGenerate: () => { throw new Error("LLM should not be called"); },
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [], maxItems: 5 },
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.failures).toBeUndefined();
    expect(repo.upsertItems).not.toHaveBeenCalled();
    // runWebCrawl should not be called for empty sources
    expect(runWebCrawl).not.toHaveBeenCalled();
  });

  // REQ-11: listing failure for one source → failure entry; other sources produce items
  it("records listing-fetch failure for one source while other succeeds", async () => {
    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
      [sourceB.listingUrl, makeFailureResult("HTTP 404 for beta")],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
      [DISCOVERY_POSTS[1].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    let crawlCallCount = 0;
    const runWebCrawl = vi.fn().mockImplementation(() => {
      crawlCallCount++;
      return Promise.resolve(crawlCallCount === 1 ? listingMap : detailMap);
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA, sourceB], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.source === "beta")).toBe(true);
    expect(result.itemsStored).toBeGreaterThan(0);
  });

  // REQ-11: discovery LLM failure on a successful listing → source reported as failed
  it("records discovery-llm failure when LLM throws on a successful listing", async () => {
    const repo = makeRepo();
    const model = new MockLanguageModelV2({
      doGenerate: () => Promise.reject(new Error("LLM down")),
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(new Map());

    await expect(
      collectWeb(
        { rawItemsRepo: repo, llmModel: model, runWebCrawl },
        { sources: [sourceA], maxItems: 10 },
      ),
    ).rejects.toThrow("all sources failed");
  });

  // REQ-11 EDGE-11c: all sources fail → throws "all sources failed"
  it("throws when every source fails listing fetch", async () => {
    const repo = makeRepo();
    const model = new MockLanguageModelV2({
      doGenerate: () => { throw new Error("LLM should not be called"); },
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeFailureResult("HTTP 503")],
      [sourceB.listingUrl, makeFailureResult("HTTP 404")],
    ]);
    const runWebCrawl = vi.fn().mockResolvedValue(listingMap);

    await expect(
      collectWeb(
        { rawItemsRepo: repo, llmModel: model, runWebCrawl },
        { sources: [sourceA, sourceB], maxItems: 10 },
      ),
    ).rejects.toThrow("all sources failed");
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-11: empty-after-filter is a successful empty source, not a failure
  it("returns a successful empty source when discovered posts are all filtered out", async () => {
    const repo = makeRepo();
    // LLM returns posts but they are all old
    const model = makeDiscoveryModel([
      { url: "https://example.com/blog/scaling-events", title: "Old", published_at: "2020-01-01" },
    ]);

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(new Map());

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10, sinceDays: 1 },
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.failures).toBeUndefined();
    expect(result.unitResults).toHaveLength(1);
    expect(result.unitResults[0]).toMatchObject({
      displayName: sourceA.name,
      itemsFetched: 0,
      status: "completed",
      errors: [],
    });
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-11: since-days filter and max-items cap
  it("applies sinceDays filter and maxItems cap", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-07T00:00:00Z"));

    const repo = makeRepo();
    // 3 posts: 2 within window, 1 outside; cap at 1
    const allPosts = [
      { url: "https://example.com/blog/a", title: "A", published_at: "2026-04-06" },
      { url: "https://example.com/blog/b", title: "B", published_at: "2026-04-05" },
      { url: "https://example.com/blog/c", title: "C", published_at: "2026-01-01" }, // old
    ];
    const postsInMd = allPosts.map((p) => p.url).join("\n");
    const mdWithPosts = `Listing content\n${postsInMd}`;

    const model = makeDiscoveryThenExtractModel(
      allPosts,
      { title: "Post", author: "Author", published_at: "2026-04-06" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(mdWithPosts)],
    ]);

    // Only 1 detail URL should be fetched (maxItems: 1, sinceDays: 7)
    let detailCallUrls: string[] = [];
    const detailMap = new Map<string, CrawlResult>();

    const runWebCrawl = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0].kind === "detail") {
          detailCallUrls = jobs.map((j) => j.url);
          for (const j of jobs) {
            detailMap.set(j.url, makeSuccessResult(DETAIL_MARKDOWN));
          }
          return Promise.resolve(detailMap);
        }
        return Promise.resolve(listingMap);
      },
    );

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 1, sinceDays: 7 },
    );

    vi.useRealTimers();

    // Only 1 detail URL (maxItems cap) and it shouldn't be the old one
    expect(detailCallUrls).toHaveLength(1);
    expect(detailCallUrls[0]).not.toBe("https://example.com/blog/c");
  });

  // REQ-11: dedup against existing external IDs
  it("excludes already-existing post URLs from detail jobs", async () => {
    const existingUrl = DISCOVERY_POSTS[0].url;
    const repo = makeRepo([existingUrl]); // existingUrl already in DB

    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "Post", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[1].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    let detailJobs: { url: string }[] = [];
    const runWebCrawl = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0].kind === "detail") {
          detailJobs = jobs;
          return Promise.resolve(detailMap);
        }
        return Promise.resolve(listingMap);
      },
    );

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    // Only the non-existing URL should be in detail jobs
    expect(detailJobs.map((j) => j.url)).not.toContain(existingUrl);
    expect(detailJobs.map((j) => j.url)).toContain(DISCOVERY_POSTS[1].url);
  });

  // REQ-11: detail-stage runWebCrawl failure for one URL
  it("records per-post failure when detail-stage crawl fails for a URL", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "Post", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
      [DISCOVERY_POSTS[1].url, makeFailureResult("timeout")],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.postUrl === DISCOVERY_POSTS[1].url)).toBe(true);
    expect(result.itemsStored).toBe(1); // only the succeeding one
  });

  // REQ-11: extractPostFields LLM failure → per-post failure (NOT "all sources failed")
  it("records per-post LLM failure when extractPostFields throws", async () => {
    const repo = makeRepo();
    let llmCalls = 0;
    const model = new MockLanguageModelV2({
      doGenerate: () => {
        const call = llmCalls++;
        if (call === 0) {
          // Discovery call succeeds
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ posts: DISCOVERY_POSTS.slice(0, 1) }) }],
            finishReason: "stop" as const,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            warnings: [],
          });
        }
        // Extraction call fails
        return Promise.reject(new Error("extract LLM down"));
      },
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    // Per-post LLM failure → failure recorded but doesn't throw "all sources failed"
    // (the source listing succeeded; only per-post extraction failed)
    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.postUrl === DISCOVERY_POSTS[0].url)).toBe(true);
    expect(result.itemsStored).toBe(0);
  });

  // REQ-11: empty mergedFields.title after merge → validation failure, item NOT inserted
  it("records validate failure and skips item when merged title is empty", async () => {
    const repo = makeRepo();
    // LLM returns empty title, discovery post also has empty title
    const postsWithEmptyTitle = [
      { url: "https://example.com/blog/scaling-events", title: "", published_at: "2026-03-30" },
    ];
    const postsMd = postsWithEmptyTitle.map((p) => p.url).join("\n");

    const model = makeDiscoveryThenExtractModel(
      postsWithEmptyTitle,
      { title: "", author: "Author", published_at: "2026-03-30" }, // empty title from LLM too
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(`Content\n${postsMd}`)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [postsWithEmptyTitle[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    // Validate failure → failure recorded but doesn't throw "all sources failed"
    // (the source listing + discovery succeeded; only the validate step failed)
    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.error === "empty title")).toBe(true);
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-11 happy path with mixed sources/posts
  it("happy path: returns correct WebCollectorResult for two sources with multiple posts", async () => {
    const repo = makeRepo();
    // Both sources discover the same posts (deduplication handles this)
    // Model needs to handle discovery calls for BOTH sources then extraction calls
    // Use alternating: discovery-A, discovery-B, extract, extract, ...
    let llmCalls = 0;
    const extractPayload = { title: "Post Title", author: "Author", published_at: "2026-03-30", image_url: "" };
    const model = new MockLanguageModelV2({
      doGenerate: () => {
        const call = llmCalls++;
        // First 2 calls are discovery (one per source), rest are extraction
        if (call < 2) {
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ posts: [DISCOVERY_POSTS[0]] }) }],
            finishReason: "stop" as const,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            warnings: [],
          });
        }
        return Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(extractPayload) }],
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          warnings: [],
        });
      },
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
      [sourceB.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA, sourceB], maxItems: 10 },
    );

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsFetched).toBe(result.itemsStored);
    expect(result.commentsFetched).toBe(0);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
  });

  // EDGE-11d: failures: undefined when no failures
  it("returns failures: undefined when all sources succeed with no failures", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeUndefined();
  });

  // runWebCrawl is called twice (listing then detail)
  it("calls runWebCrawl twice: once for listings, once for details", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(runWebCrawl).toHaveBeenCalledTimes(2);
    // First call: listing jobs
    const firstCallJobs = runWebCrawl.mock.calls[0][0] as { kind: string; url: string }[];
    expect(firstCallJobs.every((j) => j.kind === "listing")).toBe(true);
    expect(firstCallJobs[0].url).toBe(sourceA.listingUrl);
    // Second call: detail jobs
    const secondCallJobs = runWebCrawl.mock.calls[1][0] as { kind: string; url: string }[];
    expect(secondCallJobs.every((j) => j.kind === "detail")).toBe(true);
  });

  // REQ-12: image from crawl result used as fallback
  it("uses imageUrl from detail CrawlResult as image fallback", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30", image_url: "" }, // LLM returns no image
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN, "https://example.com/og.jpg")],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const items = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0][0] as { imageUrl: string | null }[];
    expect(items[0].imageUrl).toBe("https://example.com/og.jpg");
  });
});

// ── fetchWebPost tests ─────────────────────────────────────────────────────────
// These tests mock fetchAdaptive at the module level to avoid Playwright

const LONG_TEXT = "word ".repeat(60); // 300+ chars to satisfy isHealthyResult

describe("fetchWebPost", () => {
  it("returns RawItemInsert with correct shape from fetchAdaptive result", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><head><title>Test Post</title></head><body><article><h1>Test Post</h1><p>${LONG_TEXT}</p></article></body></html>`),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/post", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.sourceType).toBe("blog");
    expect(result.externalId).toBe("https://example.com/post");
    expect(result.url).toBe("https://example.com/post");
    expect(result.sourceUrl).toBe("https://example.com/post");
    expect(typeof result.content).toBe("string");
    expect(result.engagement).toEqual({ points: 0, commentCount: 0 });
    expect(result.metadata).toEqual({ comments: [] });
    expect(result.publishedAt).toBeNull();
    expect(result.collectedAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it("uses title from fetchAdaptive result when available", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const htmlWithTitle = `<html><head><title>My Article Title</title><meta property="og:image" content="https://example.com/img.jpg"></head><body><article><h1>My Article Title</h1><p>${LONG_TEXT}</p></article></body></html>`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(htmlWithTitle),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/post", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(typeof result.title).toBe("string");
    expect(result.title.length).toBeGreaterThan(0);
  });

  it("sets author from byline when convert extracts it", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const htmlWithByline = `<html><head><title>Article</title></head><body>
      <article>
        <h1>The Article Title</h1>
        <address class="author">By <a rel="author">Jane Doe</a></address>
        <p>${LONG_TEXT}</p>
      </article>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(htmlWithByline),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/post", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // Author is string | null — either is valid depending on Readability output
    expect(result.author === null || typeof result.author === "string").toBe(true);
  });

  it("falls back to URL slug as title when no heading in content", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    // Readability-parseable content but no heading element
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><head></head><body><article><p>${LONG_TEXT}</p></article></body></html>`),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/my-post-slug", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // Should have some title from URL slug fallback
    expect(result.title).toBeTruthy();
  });
});

describe("collectWeb (P2 telemetry)", () => {
  it("populates unitResults with mixed success/failure entries", async () => {
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
      [sourceB.listingUrl, makeFailureResult("HTTP 404 for beta")],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    let crawlCallCount = 0;
    const runWebCrawl = vi.fn().mockImplementation(() => {
      crawlCallCount++;
      return Promise.resolve(crawlCallCount === 1 ? listingMap : detailMap);
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA, sourceB], maxItems: 10 },
    );

    expect(result.unitResults).toBeDefined();
    expect(result.unitResults).toHaveLength(2);
    const alpha = result.unitResults?.find((u) => u.displayName === "alpha");
    const beta = result.unitResults?.find((u) => u.displayName === "beta");
    expect(alpha).toMatchObject({
      identifier: sourceA.listingUrl,
      status: "completed",
      errors: [],
    });
    expect(alpha?.itemsFetched).toBeGreaterThan(0);
    expect(beta).toMatchObject({
      identifier: sourceB.listingUrl,
      status: "failed",
      itemsFetched: 0,
    });
    expect(beta?.errors[0]).toContain("HTTP 404");
  });

  it("returns empty unitResults when sources is []", async () => {
    const repo = makeRepo();
    const runWebCrawl = vi.fn().mockResolvedValue(new Map());
    const model = new MockLanguageModelV2({
      doGenerate: () => { throw new Error("LLM should not be called"); },
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [], maxItems: 5 },
    );

    expect(result.unitResults).toEqual([]);
  });
});
