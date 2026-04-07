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
