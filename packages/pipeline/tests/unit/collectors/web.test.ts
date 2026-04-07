import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import jinaEnvelopeFixture from "@pipeline-tests/unit/fixtures/web-jina-envelope.json";
import webListingFixture from "@pipeline-tests/unit/fixtures/web-listing.json";
import webPostFixture from "@pipeline-tests/unit/fixtures/web-post.json";
import {
  discoverPostUrls,
  extractPostFields,
  validateDiscoveredUrls,
  DiscoverySchema,
  DetailSchema,
  processOnePost,
  processSource,
  type DiscoveredPost,
} from "@pipeline/collectors/web.js";
import type { BlogSource, WebCollectConfig } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

interface FetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}
type MockFetchFn = ReturnType<typeof vi.fn<[url: string, init?: RequestInit], Promise<FetchResponse>>>;

function createMockFetch(responses: { ok: boolean; status: number; body: string }[]): MockFetchFn {
  let callIndex = 0;
  return vi.fn<[url: string, init?: RequestInit], Promise<FetchResponse>>().mockImplementation(() => {
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

type FetchMarkdownFn = (url: string, fetchFn?: MockFetchFn) => Promise<string>;

describe("fetchMarkdown", () => {
  let fetchMarkdown: FetchMarkdownFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv("JINA_API_KEY", "");
    const mod = await import("@pipeline/collectors/web.js");
    fetchMarkdown = mod.fetchMarkdown as FetchMarkdownFn;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // REQ-010: happy path
  it("returns the stripped body on 200", async () => {
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: jinaEnvelopeFixture.envelope },
    ]);

    const result = await fetchMarkdown("https://example.com/post", mockFetch);

    expect(result).toBe(jinaEnvelopeFixture.expectedBody);
  });

  // REQ-010: envelope strip
  it("strips the Jina envelope (Title: / URL Source: / Markdown Content:)", async () => {
    const envelope = "Title: Foo\nURL Source: https://x\n\nMarkdown Content:\n<body>";
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: envelope },
    ]);

    const result = await fetchMarkdown("https://x", mockFetch);

    expect(result).toBe("<body>");
  });

  // REQ-010 edge: no envelope
  it("returns raw trimmed when envelope is missing", async () => {
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: "  just some markdown body  " },
    ]);

    const result = await fetchMarkdown("https://example.com/post", mockFetch);

    expect(result).toBe("just some markdown body");
  });

  // REQ-100: retry on 429
  it("retries on 429 and returns body on second attempt", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 429, body: "rate limited" },
      { ok: true, status: 200, body: jinaEnvelopeFixture.envelope },
    ]);

    const result = await fetchMarkdown("https://example.com/post", mockFetch);

    expect(result).toBe(jinaEnvelopeFixture.expectedBody);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // REQ-100: retry on 5xx up to MAX_RETRIES then throw
  it("retries on 502 up to MAX_RETRIES then throws", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 502, body: "bad gateway" },
      { ok: false, status: 502, body: "bad gateway" },
      { ok: false, status: 502, body: "bad gateway" },
    ]);

    await expect(fetchMarkdown("https://example.com/post", mockFetch)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // REQ-101: non-retryable 4xx
  it("does not retry on 404", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 404, body: "not found" },
    ]);

    await expect(fetchMarkdown("https://example.com/post", mockFetch)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // REQ-101: non-retryable 4xx
  it("does not retry on 400", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 400, body: "bad request" },
    ]);

    await expect(fetchMarkdown("https://example.com/post", mockFetch)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("adds Authorization header when JINA_API_KEY is set", async () => {
    vi.stubEnv("JINA_API_KEY", "secret-key");
    vi.resetModules();
    const mod = await import("@pipeline/collectors/web.js");
    const fetchMarkdownWithKey = mod.fetchMarkdown as FetchMarkdownFn;
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: jinaEnvelopeFixture.envelope },
    ]);

    await fetchMarkdownWithKey("https://example.com/post", mockFetch);

    const init = mockFetch.mock.calls[0][1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer secret-key");
  });

  it("omits Authorization header when JINA_API_KEY is unset", async () => {
    vi.stubEnv("JINA_API_KEY", "");
    vi.resetModules();
    const mod = await import("@pipeline/collectors/web.js");
    const fetchMarkdownNoKey = mod.fetchMarkdown as FetchMarkdownFn;
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: jinaEnvelopeFixture.envelope },
    ]);

    await fetchMarkdownNoKey("https://example.com/post", mockFetch);

    const init = mockFetch.mock.calls[0][1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });
});

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

function makeDiscoveryMockModel(jsonObject: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(jsonObject) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: {
            total: 20,
            text: 20,
            reasoning: undefined,
            cached: undefined,
          },
        },
        warnings: [],
      }),
  });
}

function makeThrowingModel(message: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: () => Promise.reject(new Error(message)),
  });
}

function getCallOrThrow(
  calls: readonly LanguageModelV3CallOptions[],
  index: number,
): LanguageModelV3CallOptions {
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
    it("returns title/author/published_at from mocked LLM", async () => {
      const fakeFields = {
        title: "Scaling our event pipeline to 10M events/sec",
        author: "Jane Doe",
        published_at: "2026-03-30",
      };
      const model = makeDiscoveryMockModel(fakeFields);

      const result = await extractPostFields(post.postUrl, post.markdown, model);

      expect(result).toEqual(fakeFields);
    });

    it("passes temperature 0 to generateText", async () => {
      const model = makeDiscoveryMockModel({ title: "", author: "", published_at: "" });

      await extractPostFields(post.postUrl, post.markdown, model);

      expect(model.doGenerateCalls).toHaveLength(1);
      const call = getCallOrThrow(model.doGenerateCalls, 0);
      expect(call.temperature).toBe(0);
    });

    it("passes DetailSchema to generateText", async () => {
      const model = makeDiscoveryMockModel({ title: "", author: "", published_at: "" });

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

      const result = validateDiscoveredUrls(posts, listing.markdown);

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

      const result = validateDiscoveredUrls(posts, listing.markdown);

      expect(result).toHaveLength(3);
    });

    it("handles empty input gracefully", () => {
      const result = validateDiscoveredUrls([], listing.markdown);
      expect(result).toEqual([]);
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
      });
      expect(parsed.title).toBe("T");
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

  let applySinceDays: ApplySinceDaysFn;
  let parseDateOrNull: ParseDateOrNullFn;
  let buildRawItem: BuildRawItemFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-07T00:00:00Z"));
    const mod = await import("@pipeline/collectors/web.js");
    applySinceDays = mod.applySinceDays as ApplySinceDaysFn;
    parseDateOrNull = mod.parseDateOrNull as ParseDateOrNullFn;
    buildRawItem = mod.buildRawItem as BuildRawItemFn;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applySinceDays returns input unchanged when sinceDays is undefined", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/a", title: "A", published_at: "2020-01-01" },
      { url: "https://x/b", title: "B", published_at: "" },
    ];
    expect(applySinceDays(posts, undefined)).toEqual(posts);
  });

  // REQ-020
  it("applySinceDays drops posts older than the cutoff", () => {
    const tenDaysAgo = new Date("2026-03-28T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/old", title: "Old", published_at: tenDaysAgo },
    ];
    expect(applySinceDays(posts, 7)).toEqual([]);
  });

  // REQ-020
  it("applySinceDays keeps posts within the cutoff", () => {
    const fiveDaysAgo = new Date("2026-04-02T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/new", title: "New", published_at: fiveDaysAgo },
    ];
    expect(applySinceDays(posts, 7)).toEqual(posts);
  });

  // REQ-021
  it("applySinceDays keeps posts with empty published_at even when sinceDays is set", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/empty", title: "Empty", published_at: "" },
    ];
    expect(applySinceDays(posts, 7)).toEqual(posts);
  });

  // REQ-022
  it("applySinceDays keeps posts with unparseable published_at", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/bad", title: "Bad", published_at: "not a date" },
    ];
    expect(applySinceDays(posts, 7)).toEqual(posts);
  });

  it("applySinceDays keeps a post exactly at the cutoff boundary", () => {
    const cutoff = new Date("2026-03-31T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/edge", title: "Edge", published_at: cutoff },
    ];
    expect(applySinceDays(posts, 7)).toEqual(posts);
  });

  it("parseDateOrNull returns null for empty string", () => {
    expect(parseDateOrNull("")).toBeNull();
  });

  it("parseDateOrNull returns null for null input", () => {
    expect(parseDateOrNull(null)).toBeNull();
  });

  // REQ-051
  it("parseDateOrNull returns null for unparseable input", () => {
    expect(parseDateOrNull("not a date")).toBeNull();
  });

  it("parseDateOrNull returns a Date for YYYY-MM-DD input", () => {
    const result = parseDateOrNull("2026-04-07");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-04-07T00:00:00.000Z");
  });

  it("parseDateOrNull returns a Date for full ISO-8601 input", () => {
    const result = parseDateOrNull("2026-04-07T10:30:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-04-07T10:30:00.000Z");
  });

  // REQ-050
  it("buildRawItem produces correct shape with all required fields", () => {
    const item = buildRawItem(
      "https://example.com/post-1",
      "# Body markdown",
      { title: "Post 1", author: "Jane Doe", published_at: "2026-04-01T00:00:00Z" },
    );
    expect(item.sourceType).toBe("blog");
    expect(item.externalId).toBe("https://example.com/post-1");
    expect(item.url).toBe("https://example.com/post-1");
    expect(item.sourceUrl).toBe("https://example.com/post-1");
    expect(item.title).toBe("Post 1");
    expect(item.author).toBe("Jane Doe");
    expect(item.content).toBe("# Body markdown");
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
    const item = buildRawItem(
      "https://example.com/post-2",
      "body",
      { title: "T", author: "   ", published_at: "" },
    );
    expect(item.author).toBeNull();
  });

  // REQ-051
  it("buildRawItem sets publishedAt to null when published_at is unparseable", () => {
    const item = buildRawItem(
      "https://example.com/post-3",
      "body",
      { title: "T", author: "A", published_at: "not a date" },
    );
    expect(item.publishedAt).toBeNull();
  });
});

describe("processOnePost and processSource", () => {
  const POST_BODY = "Title: Some Post\nURL Source: https://example.com/blog/scaling-events\n\nMarkdown Content:\nthe post body";

  function makeFetch(body: string): ReturnType<typeof vi.fn> {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(body),
    });
  }

  function makeFetchThrowing(): ReturnType<typeof vi.fn> {
    return vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    });
  }

  function makeNeverCalledModel(): MockLanguageModelV3 {
    return new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("LLM should not be called in this test");
      },
    });
  }

  function makeExtractModel(fields: { title: string; author: string; published_at: string }): MockLanguageModelV3 {
    return new MockLanguageModelV3({
      doGenerate: () =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(fields) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 20, text: 20, reasoning: undefined, cached: undefined },
          },
          warnings: [],
        }),
    });
  }

  function makeRepo(existing: string[] = []): RawItemsRepo {
    return {
      upsertItems: vi.fn().mockResolvedValue(undefined),
      findExistingExternalIds: vi.fn().mockResolvedValue(new Set(existing)),
    };
  }

  const samplePost: DiscoveredPost = {
    url: "https://example.com/blog/scaling-events",
    title: "Scaling our event pipeline to 10M events/sec",
    published_at: "2026-03-30",
  };

  describe("processOnePost", () => {
    async function captureError(fn: () => Promise<unknown>): Promise<Error & { stage?: string }> {
      let caught: unknown = null;
      try {
        await fn();
      } catch (err) {
        caught = err;
      }
      if (!(caught instanceof Error)) {
        throw new Error("expected function to throw an Error");
      }
      return caught as Error & { stage?: string };
    }

    // REQ-076
    it("throws CollectorError with stage 'detail-fetch' when fetchMarkdown throws", async () => {
      const fetchFn = makeFetchThrowing();
      const model = makeNeverCalledModel();

      const err = await captureError(() =>
        processOnePost(samplePost, fetchFn as unknown as typeof fetch, model),
      );

      expect(err.stage).toBe("detail-fetch");
    });

    // REQ-077
    it("throws CollectorError with stage 'detail-llm' when extractPostFields throws", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = new MockLanguageModelV3({
        doGenerate: () => Promise.reject(new Error("LLM down")),
      });

      const err = await captureError(() =>
        processOnePost(samplePost, fetchFn as unknown as typeof fetch, model),
      );

      expect(err.stage).toBe("detail-llm");
    });

    // REQ-078
    it("throws CollectorError with stage 'validate' when extracted title is empty string", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({ title: "   ", author: "Jane", published_at: "2026-03-30" });

      const err = await captureError(() =>
        processOnePost(samplePost, fetchFn as unknown as typeof fetch, model),
      );

      expect(err.stage).toBe("validate");
    });

    it("returns RawItemInsert on happy path", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({
        title: "Scaling our event pipeline",
        author: "Jane Doe",
        published_at: "2026-03-30",
      });

      const result = await processOnePost(samplePost, fetchFn as unknown as typeof fetch, model);

      expect(result.title).toBe("Scaling our event pipeline");
      expect(result.author).toBe("Jane Doe");
      expect(result.url).toBe(samplePost.url);
      expect(result.externalId).toBe(samplePost.url);
      expect(result.sourceType).toBe("blog");
    });
  });

  describe("processSource", () => {
    const source: BlogSource = {
      name: "example",
      listingUrl: "https://example.com/blog",
    };
    const baseConfig: WebCollectConfig = {
      sources: [source],
      maxItems: 10,
    };

    const listing = webListingFixture as { listingUrl: string; markdown: string };

    function makeListingFetch(opts: {
      listingFails?: boolean;
      postBody?: string;
    } = {}): ReturnType<typeof vi.fn> {
      return vi.fn().mockImplementation((url: string) => {
        if (url.endsWith(source.listingUrl)) {
          if (opts.listingFails) {
            return Promise.resolve({
              ok: false,
              status: 404,
              text: () => Promise.resolve("not found"),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(`URL Source: ${source.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(opts.postBody ?? POST_BODY),
        });
      });
    }

    function makeDiscoveryThenExtractModel(
      discovery: { posts: { url: string; title: string; published_at: string }[] },
      extract: { title: string; author: string; published_at: string },
    ): MockLanguageModelV3 {
      let calls = 0;
      return new MockLanguageModelV3({
        doGenerate: () => {
          const isDiscovery = calls === 0;
          calls++;
          const payload = isDiscovery ? discovery : extract;
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify(payload) }],
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 20, text: 20, reasoning: undefined, cached: undefined },
            },
            warnings: [],
          });
        },
      });
    }

    // REQ-072
    it("records source-level failure (no postUrl) when listing fetchMarkdown throws", async () => {
      const fetchFn = makeListingFetch({ listingFails: true });
      const model = makeNeverCalledModel();
      const repo = makeRepo();

      const result = await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(result.sourceFailed).toBe(true);
      expect(result.items).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].source).toBe("example");
      expect(result.failures[0].postUrl).toBeUndefined();
      expect(result.failures[0].error).toContain("404");
    });

    // REQ-073
    it("records source-level failure when discoverPostUrls throws", async () => {
      const fetchFn = makeListingFetch();
      const model = new MockLanguageModelV3({
        doGenerate: () => Promise.reject(new Error("llm discovery failed")),
      });
      const repo = makeRepo();

      const result = await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(result.sourceFailed).toBe(true);
      expect(result.items).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].source).toBe("example");
      expect(result.failures[0].postUrl).toBeUndefined();
    });

    // REQ-074
    it("records source-level 'discovery-empty' failure when capped is empty after sinceDays filter", async () => {
      const fetchFn = makeListingFetch();
      const model = makeDiscoveryThenExtractModel(
        {
          posts: [
            { url: "https://example.com/blog/scaling-events", title: "Old", published_at: "2020-01-01" },
            { url: "https://example.com/blog/rust-scheduler", title: "Old", published_at: "2020-01-02" },
          ],
        },
        { title: "x", author: "y", published_at: "2020-01-01" },
      );
      const repo = makeRepo();

      const result = await processSource(
        source,
        { ...baseConfig, sinceDays: 1 },
        {
          rawItemsRepo: repo,
          fetchFn: fetchFn as unknown as typeof fetch,
          llmModel: model,
        },
      );

      expect(result.sourceFailed).toBe(true);
      expect(result.items).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].error).toContain("no posts");
    });

    // REQ-075
    it("returns sourceFailed: false and items: [] when all capped posts already exist (dedup)", async () => {
      const fetchFn = makeListingFetch();
      const discoveredUrls = [
        "https://example.com/blog/scaling-events",
        "https://example.com/blog/rust-scheduler",
      ];
      const model = makeDiscoveryThenExtractModel(
        {
          posts: discoveredUrls.map((u) => ({ url: u, title: "T", published_at: "2026-03-30" })),
        },
        { title: "x", author: "y", published_at: "2026-03-30" },
      );
      const repo = makeRepo(discoveredUrls);

      const result = await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(result.sourceFailed).toBe(false);
      expect(result.items).toEqual([]);
      expect(result.failures).toEqual([]);
    });

    // REQ-012
    it("drops hallucinated URLs from discovery before filtering", async () => {
      const fetchFn = makeListingFetch();
      const model = makeDiscoveryThenExtractModel(
        {
          posts: [
            { url: "https://example.com/blog/scaling-events", title: "Real", published_at: "2026-03-30" },
            { url: "https://example.com/blog/hallucinated", title: "Fake", published_at: "2026-03-30" },
          ],
        },
        { title: "Real Title", author: "Author", published_at: "2026-03-30" },
      );
      const repo = makeRepo();

      const result = await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(repo.findExistingExternalIds).toHaveBeenCalledWith("blog", [
        "https://example.com/blog/scaling-events",
      ]);
      expect(result.items).toHaveLength(1);
    });

    // REQ-031
    it("calls findExistingExternalIds with the capped URLs", async () => {
      const fetchFn = makeListingFetch();
      const model = makeDiscoveryThenExtractModel(
        {
          posts: [
            { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
            { url: "https://example.com/blog/rust-scheduler", title: "B", published_at: "2026-03-30" },
            { url: "https://example.com/blog/remote-oncall", title: "C", published_at: "2026-03-30" },
          ],
        },
        { title: "T", author: "A", published_at: "2026-03-30" },
      );
      const repo = makeRepo();

      await processSource(
        source,
        { ...baseConfig, maxItems: 2 },
        {
          rawItemsRepo: repo,
          fetchFn: fetchFn as unknown as typeof fetch,
          llmModel: model,
        },
      );

      expect(repo.findExistingExternalIds).toHaveBeenCalledWith("blog", [
        "https://example.com/blog/scaling-events",
        "https://example.com/blog/rust-scheduler",
      ]);
    });

    // REQ-061
    it("with postConcurrency 2 never exceeds 2 in-flight processOnePost calls", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const fetchFn = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith(source.listingUrl)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                `URL Source: ${source.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
              ),
          });
        }
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight--;
            resolve({
              ok: true,
              status: 200,
              text: () => Promise.resolve(POST_BODY),
            });
          }, 20);
        });
      });

      const model = makeDiscoveryThenExtractModel(
        {
          posts: [
            { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
            { url: "https://example.com/blog/rust-scheduler", title: "B", published_at: "2026-03-30" },
            { url: "https://example.com/blog/remote-oncall", title: "C", published_at: "2026-03-30" },
            { url: "https://example.com/blog/cloud-cost", title: "D", published_at: "2026-03-30" },
          ],
        },
        { title: "T", author: "A", published_at: "2026-03-30" },
      );
      const repo = makeRepo();

      const result = await processSource(
        source,
        { ...baseConfig, postConcurrency: 2 },
        {
          rawItemsRepo: repo,
          fetchFn: fetchFn as unknown as typeof fetch,
          llmModel: model,
        },
      );

      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(result.items).toHaveLength(4);
    });

    // REQ-062
    it("defaults to postConcurrency 3 when unspecified", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const fetchFn = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith(source.listingUrl)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                `URL Source: ${source.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
              ),
          });
        }
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight--;
            resolve({
              ok: true,
              status: 200,
              text: () => Promise.resolve(POST_BODY),
            });
          }, 20);
        });
      });

      const model = makeDiscoveryThenExtractModel(
        {
          posts: [
            { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
            { url: "https://example.com/blog/rust-scheduler", title: "B", published_at: "2026-03-30" },
            { url: "https://example.com/blog/remote-oncall", title: "C", published_at: "2026-03-30" },
            { url: "https://example.com/blog/cloud-cost", title: "D", published_at: "2026-03-30" },
            { url: "https://example.com/blog/feature-flags", title: "E", published_at: "2026-03-30" },
          ],
        },
        { title: "T", author: "A", published_at: "2026-03-30" },
      );
      const repo = makeRepo();

      await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(maxInFlight).toBeLessThanOrEqual(3);
      expect(maxInFlight).toBeGreaterThan(2);
    });

    // REQ-081
    it("truncates error strings longer than MAX_ERROR_LENGTH in recorded failures", async () => {
      const longMessage = "x".repeat(10_000);
      const fetchFn = makeListingFetch();
      let calls = 0;
      const model = new MockLanguageModelV3({
        doGenerate: () => {
          const isDiscovery = calls === 0;
          calls++;
          if (isDiscovery) {
            return Promise.resolve({
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    posts: [
                      { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
                    ],
                  }),
                },
              ],
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 20, text: 20, reasoning: undefined, cached: undefined },
              },
              warnings: [],
            });
          }
          return Promise.reject(new Error(longMessage));
        },
      });
      const repo = makeRepo();

      const result = await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].error.length).toBeLessThanOrEqual(200);
    });

    it("returns mixed outcomes — 2 succeed and 1 fails with detail-fetch", async () => {
      const failingUrl = "https://example.com/blog/rust-scheduler";
      const fetchFn = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith(source.listingUrl)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                `URL Source: ${source.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
              ),
          });
        }
        if (url.includes(failingUrl)) {
          return Promise.resolve({
            ok: false,
            status: 404,
            text: () => Promise.resolve("not found"),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(POST_BODY),
        });
      });
      const model = makeDiscoveryThenExtractModel(
        {
          posts: [
            { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
            { url: failingUrl, title: "B", published_at: "2026-03-30" },
            { url: "https://example.com/blog/remote-oncall", title: "C", published_at: "2026-03-30" },
          ],
        },
        { title: "T", author: "A", published_at: "2026-03-30" },
      );
      const repo = makeRepo();

      const result = await processSource(source, baseConfig, {
        rawItemsRepo: repo,
        fetchFn: fetchFn as unknown as typeof fetch,
        llmModel: model,
      });

      expect(result.items).toHaveLength(2);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].postUrl).toBe(failingUrl);
      expect(result.sourceFailed).toBe(false);
    });
  });
});
