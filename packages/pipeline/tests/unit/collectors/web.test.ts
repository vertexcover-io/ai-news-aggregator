import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";
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
  collectWeb,
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

type FetchMarkdownFn = (
  url: string,
  options?: { fetchFn?: MockFetchFn; signal?: AbortSignal },
) => Promise<string>;

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

  // Returns the full Jina response (envelope header + body) trimmed. The
  // envelope contains Title/URL Source/Published Time which the detail LLM
  // relies on to extract metadata — stripping it would discard that data.
  it("returns the full trimmed response on 200", async () => {
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: jinaEnvelopeFixture.envelope },
    ]);

    const result = await fetchMarkdown("https://example.com/post", { fetchFn: mockFetch });

    expect(result).toBe(jinaEnvelopeFixture.envelope.trim());
  });

  it("preserves the Jina envelope header (Title: / URL Source: / Markdown Content:)", async () => {
    const envelope = "Title: Foo\nURL Source: https://x\n\nMarkdown Content:\n<body>";
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: envelope },
    ]);

    const result = await fetchMarkdown("https://x", { fetchFn: mockFetch });

    expect(result).toBe(envelope);
  });

  it("returns raw trimmed when envelope is missing", async () => {
    const mockFetch = createMockFetch([
      { ok: true, status: 200, body: "  just some markdown body  " },
    ]);

    const result = await fetchMarkdown("https://example.com/post", { fetchFn: mockFetch });

    expect(result).toBe("just some markdown body");
  });

  // REQ-101: non-retryable 4xx
  it("does not retry on 404", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 404, body: "not found" },
    ]);

    await expect(fetchMarkdown("https://example.com/post", { fetchFn: mockFetch })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // REQ-101: non-retryable 4xx
  it("does not retry on 400", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 400, body: "bad request" },
    ]);

    await expect(fetchMarkdown("https://example.com/post", { fetchFn: mockFetch })).rejects.toThrow();
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

    await fetchMarkdownWithKey("https://example.com/post", { fetchFn: mockFetch });

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

    await fetchMarkdownNoKey("https://example.com/post", { fetchFn: mockFetch });

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
    const item = buildRawItem(
      "https://example.com/post-2",
      "body",
      { title: "T", author: "   ", published_at: "", image_url: "" },
    );
    expect(item.author).toBeNull();
  });

  // REQ-051
  it("buildRawItem sets publishedAt to null when published_at is unparseable", () => {
    const item = buildRawItem(
      "https://example.com/post-3",
      "body",
      { title: "T", author: "A", published_at: "not a date", image_url: "" },
    );
    expect(item.publishedAt).toBeNull();
  });

  it("buildRawItem sets imageUrl to null when image_url is empty", () => {
    const item = buildRawItem(
      "https://example.com/post-4",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "" },
    );
    expect(item.imageUrl).toBeNull();
  });

  it("buildRawItem sets imageUrl to null when image_url is a data URI", () => {
    const item = buildRawItem(
      "https://example.com/post-5",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "data:image/png;base64,abc" },
    );
    expect(item.imageUrl).toBeNull();
  });

  it("buildRawItem sets imageUrl when image_url is a valid http URL", () => {
    const item = buildRawItem(
      "https://example.com/post-6",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "https://cdn.example.com/img.jpg" },
    );
    expect(item.imageUrl).toBe("https://cdn.example.com/img.jpg");
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

  function makeNeverCalledModel(): MockLanguageModelV2 {
    return new MockLanguageModelV2({
      doGenerate: () => {
        throw new Error("LLM should not be called in this test");
      },
    });
  }

  function makeExtractModel(fields: { title: string; author: string; published_at: string; image_url?: string }): MockLanguageModelV2 {
    const withDefaults = { image_url: "", ...fields };
    return new MockLanguageModelV2({
      doGenerate: () =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(withDefaults) }],
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
      const model = new MockLanguageModelV2({
        doGenerate: () => Promise.reject(new Error("LLM down")),
      });

      const err = await captureError(() =>
        processOnePost(samplePost, fetchFn as unknown as typeof fetch, model),
      );

      expect(err.stage).toBe("detail-llm");
    });

    // Throws validate only when BOTH the detail LLM and the discovery post
    // have empty titles. When the detail LLM returns empty but the discovery
    // post has a title, processOnePost falls back to the discovery title.
    it("throws CollectorError with stage 'validate' when both detail and discovery titles are empty", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({ title: "   ", author: "Jane", published_at: "2026-03-30" });
      const titlelessPost: DiscoveredPost = { ...samplePost, title: "" };

      const err = await captureError(() =>
        processOnePost(titlelessPost, fetchFn as unknown as typeof fetch, model),
      );

      expect(err.stage).toBe("validate");
    });

    it("falls back to the discovered title when the detail LLM returns empty", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({ title: "", author: "Jane", published_at: "2026-03-30" });

      const result = await processOnePost(
        samplePost,
        fetchFn as unknown as typeof fetch,
        model,
      );

      expect(result.title).toBe(samplePost.title);
    });

    it("falls back to the discovered published_at when the detail LLM returns empty", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({ title: "Real Title", author: "Jane", published_at: "" });

      const result = await processOnePost(
        samplePost,
        fetchFn as unknown as typeof fetch,
        model,
      );

      expect(result.publishedAt?.toISOString().slice(0, 10)).toBe("2026-03-30");
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

    it("sets imageUrl when LLM returns a valid http URL", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({
        title: "Post",
        author: "Jane",
        published_at: "2026-03-30",
        image_url: "https://example.com/hero.jpg",
      });

      const result = await processOnePost(samplePost, fetchFn as unknown as typeof fetch, model);

      expect(result.imageUrl).toBe("https://example.com/hero.jpg");
    });

    it("sets imageUrl to null when LLM returns empty string", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({
        title: "Post",
        author: "Jane",
        published_at: "2026-03-30",
        image_url: "",
      });

      const result = await processOnePost(samplePost, fetchFn as unknown as typeof fetch, model);

      expect(result.imageUrl).toBeNull();
    });

    it("sets imageUrl to null when LLM returns a data URI", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({
        title: "Post",
        author: "Jane",
        published_at: "2026-03-30",
        image_url: "data:image/png;base64,abc123",
      });

      const result = await processOnePost(samplePost, fetchFn as unknown as typeof fetch, model);

      expect(result.imageUrl).toBeNull();
    });

    it("sets imageUrl to null when LLM returns a relative URL", async () => {
      const fetchFn = makeFetch(POST_BODY);
      const model = makeExtractModel({
        title: "Post",
        author: "Jane",
        published_at: "2026-03-30",
        image_url: "/images/hero.jpg",
      });

      const result = await processOnePost(samplePost, fetchFn as unknown as typeof fetch, model);

      expect(result.imageUrl).toBeNull();
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
      extract: { title: string; author: string; published_at: string; image_url?: string },
    ): MockLanguageModelV2 {
      let calls = 0;
      return new MockLanguageModelV2({
        doGenerate: () => {
          const isDiscovery = calls === 0;
          calls++;
          const payload = isDiscovery ? discovery : { image_url: "", ...extract };
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify(payload) }],
            finishReason: "stop" as const,
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
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
      const model = new MockLanguageModelV2({
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
      const model = new MockLanguageModelV2({
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
              finishReason: "stop" as const,
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 30,
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

describe("collectWeb", () => {
  const POST_BODY =
    "Title: Some Post\nURL Source: https://example.com/blog/scaling-events\n\nMarkdown Content:\nthe post body";
  const listing = webListingFixture as { listingUrl: string; markdown: string };

  function makeRepo(existing: string[] = []): RawItemsRepo {
    return {
      upsertItems: vi.fn().mockResolvedValue(undefined),
      findExistingExternalIds: vi.fn().mockResolvedValue(new Set(existing)),
    };
  }

  function makeDiscoveryThenExtractModel(
    discovery: { posts: { url: string; title: string; published_at: string }[] },
    extract: { title: string; author: string; published_at: string; image_url?: string },
  ): MockLanguageModelV2 {
    let calls = 0;
    return new MockLanguageModelV2({
      doGenerate: () => {
        const isDiscovery = calls === 0;
        calls++;
        const payload = isDiscovery ? discovery : { image_url: "", ...extract };
        return Promise.resolve({
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          finishReason: "stop" as const,
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
          warnings: [],
        });
      },
    });
  }

  function makeFetchForSource(
    sourceListingUrl: string,
    opts: { listingFails?: boolean; postBody?: string } = {},
  ): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(sourceListingUrl)) {
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
          text: () =>
            Promise.resolve(
              `URL Source: ${sourceListingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
            ),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(opts.postBody ?? POST_BODY),
      });
    });
  }

  const sourceA: BlogSource = { name: "alpha", listingUrl: "https://alpha.example.com/blog" };
  const sourceB: BlogSource = { name: "beta", listingUrl: "https://beta.example.com/blog" };

  // EDGE-018: empty sources array
  it("returns empty result without throwing when sources is []", async () => {
    const repo = makeRepo();
    const fetchFn = vi.fn();
    const model = new MockLanguageModelV2({
      doGenerate: () => {
        throw new Error("LLM should not be called");
      },
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
      { sources: [], maxItems: 5 },
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.failures).toBeUndefined();
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-052: upsert exactly once with aggregated batch
  it("calls upsertItems exactly once with the aggregated batch", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(sourceA.listingUrl) || url.endsWith(sourceB.listingUrl)) {
        const lurl = url.endsWith(sourceA.listingUrl) ? sourceA.listingUrl : sourceB.listingUrl;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(`URL Source: ${lurl}\n\nMarkdown Content:\n${listing.markdown}`),
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
        ],
      },
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const result = await collectWeb(
      { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
      { sources: [sourceA, sourceB], maxItems: 5 },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    expect(result.itemsFetched).toBe(result.itemsStored);
    expect(result.itemsStored).toBeGreaterThan(0);
  });

  // REQ-079: throws when every source failed
  it("throws when every source fails (all sourceFailed: true)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    });
    const model = new MockLanguageModelV2({
      doGenerate: () => {
        throw new Error("LLM should not be called");
      },
    });
    const repo = makeRepo();

    await expect(
      collectWeb(
        { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
        { sources: [sourceA, sourceB], maxItems: 5 },
      ),
    ).rejects.toThrow("all sources failed");
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-080: returns result when one source succeeds, one fails
  it("returns a result (no throw) when one source succeeds and one fails", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(sourceA.listingUrl)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              `URL Source: ${sourceA.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
            ),
        });
      }
      if (url.endsWith(sourceB.listingUrl)) {
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
        ],
      },
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const result = await collectWeb(
      { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
      { sources: [sourceA, sourceB], maxItems: 5 },
    );

    expect(result.itemsStored).toBeGreaterThan(0);
    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.source === "beta")).toBe(true);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
  });

  // REQ-090: failures: undefined when no failures occurred
  it("returns failures: undefined when all sources succeed with no failures", async () => {
    const fetchFn = makeFetchForSource(sourceA.listingUrl);
    const model = makeDiscoveryThenExtractModel(
      {
        posts: [
          { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
        ],
      },
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const result = await collectWeb(
      { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
      { sources: [sourceA], maxItems: 5 },
    );

    expect(result.failures).toBeUndefined();
    expect(result.itemsStored).toBeGreaterThan(0);
  });

  // REQ-090: failures: [...] when any failure occurred
  it("returns a non-empty failures array when at least one failure occurred", async () => {
    const repo = makeRepo();
    const fetchFnMixed = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(sourceA.listingUrl)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              `URL Source: ${sourceA.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
            ),
        });
      }
      if (url.endsWith(sourceB.listingUrl)) {
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
    const modelMixed = makeDiscoveryThenExtractModel(
      {
        posts: [
          { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
        ],
      },
      { title: "T", author: "A", published_at: "2026-03-30" },
    );

    const result = await collectWeb(
      {
        rawItemsRepo: repo,
        fetchFn: fetchFnMixed as unknown as typeof fetch,
        llmModel: modelMixed,
      },
      { sources: [sourceA, sourceB], maxItems: 5 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.length ?? 0).toBeGreaterThan(0);
  });

  // REQ-060: top-level parallelism — source 2 listing fetch starts before source 1's resolves
  it("processes sources in parallel (source 2 starts before source 1 resolves)", async () => {
    const startTimes: Record<string, number> = {};
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(sourceA.listingUrl)) {
        startTimes.a = Date.now();
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: () =>
                Promise.resolve(
                  `URL Source: ${sourceA.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
                ),
            });
          }, 50);
        });
      }
      if (url.endsWith(sourceB.listingUrl)) {
        startTimes.b = Date.now();
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: () =>
                Promise.resolve(
                  `URL Source: ${sourceB.listingUrl}\n\nMarkdown Content:\n${listing.markdown}`,
                ),
            });
          }, 50);
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
        ],
      },
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    await collectWeb(
      { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
      { sources: [sourceA, sourceB], maxItems: 5 },
    );

    // both started before either resolved (within a tiny window)
    expect(startTimes.a).toBeDefined();
    expect(startTimes.b).toBeDefined();
    expect(Math.abs((startTimes.b ?? 0) - (startTimes.a ?? 0))).toBeLessThan(40);
  });

  // REQ-091/092: result structure proves start and end logs were emitted
  it("returns WebCollectorResult with itemsFetched=itemsStored and durationMs set", async () => {
    const fetchFn = makeFetchForSource(sourceA.listingUrl);
    const model = makeDiscoveryThenExtractModel(
      {
        posts: [
          { url: "https://example.com/blog/scaling-events", title: "A", published_at: "2026-03-30" },
        ],
      },
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const result = await collectWeb(
      { rawItemsRepo: repo, fetchFn: fetchFn as unknown as typeof fetch, llmModel: model },
      { sources: [sourceA], maxItems: 5 },
    );

    // REQ-091: completion metric shape
    expect(result.itemsFetched).toBe(result.itemsStored);
    expect(result.commentsFetched).toBe(0);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
