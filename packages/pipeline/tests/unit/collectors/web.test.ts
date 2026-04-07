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
  type DiscoveredPost,
} from "@pipeline/collectors/web.js";

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
