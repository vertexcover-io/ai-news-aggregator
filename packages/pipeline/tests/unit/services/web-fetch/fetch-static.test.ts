import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";

// Mock the convert module before importing fetch-static
vi.mock("@pipeline/services/web-fetch/convert.js", () => ({
  convert: vi.fn(),
}));

// Dynamic import after mocking
const { fetchStatic } = await import(
  "@pipeline/services/web-fetch/fetch-static.js"
);
const { convert } = await import("@pipeline/services/web-fetch/convert.js");

const MOCK_RESULT: ConvertResult = {
  markdown: "# Hello World",
  title: "Hello World",
  byline: null,
  imageUrl: null,
  textLength: 300,
  publishedAt: null,
  structuredData: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(convert).mockReturnValue(MOCK_RESULT);
});

describe("fetchStatic", () => {
  it("returns ConvertResult on 200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html><body>content</body></html>"),
    } as unknown as Response);

    const result = await fetchStatic(
      "https://example.com/post",
      "article",
      { fetchFn: mockFetch },
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(convert).toHaveBeenCalledWith({
      html: "<html><body>content</body></html>",
      baseUrl: "https://example.com/post",
      mode: "article",
    });
    expect(result).toEqual(MOCK_RESULT);
  });

  it("throws Error with status on non-2xx response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as unknown as Response);

    await expect(
      fetchStatic("https://example.com/post", "article", { fetchFn: mockFetch }),
    ).rejects.toThrow("HTTP 404 for https://example.com/post");
  });

  it("throws immediately if signal is pre-aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>"),
    } as unknown as Response);

    await expect(
      fetchStatic("https://example.com/post", "article", {
        fetchFn: mockFetch,
        signal: ac.signal,
      }),
    ).rejects.toThrow();
  });

  it("propagates abort error if signal aborts mid-fetch", async () => {
    const ac = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");

    const mockFetch = vi.fn().mockRejectedValue(abortError);

    await expect(
      fetchStatic("https://example.com/post", "article", {
        fetchFn: mockFetch,
        signal: ac.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  it("forwards signal to the underlying fetch (default fetchFn path)", async () => {
    // This test verifies the default fetchFn is a pass-through (not dropping init)
    const ac = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");

    // Mock globalThis.fetch to verify signal is forwarded
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

    await expect(
      fetchStatic("https://example.com/post", "article", {
        signal: ac.signal,
      }),
    ).rejects.toThrow("aborted");

    // Verify fetch was called with the signal in init
    expect(spy).toHaveBeenCalledWith("https://example.com/post", {
      signal: ac.signal,
    });

    spy.mockRestore();
  });
});

describe("fetchStatic proxy dispatcher (REQ-002/005/006/010)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("attaches a dispatcher on the default fetch path when WEB_HTTP_PROXY is set (REQ-002)", async () => {
    vi.stubEnv("WEB_HTTP_PROXY", "http://u:p@h:1");

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>"),
    } as unknown as Response);

    await fetchStatic("https://example.com/post", "article");

    const init = spy.mock.calls[0]?.[1] as
      | (RequestInit & { dispatcher?: unknown })
      | undefined;
    expect(init?.dispatcher).toBeTypeOf("object");
    expect(init?.dispatcher).not.toBeNull();
  });

  it("does NOT attach a dispatcher when a fetchFn is injected (REQ-006)", async () => {
    vi.stubEnv("WEB_HTTP_PROXY", "http://u:p@h:1");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>"),
    } as unknown as Response);

    await fetchStatic("https://example.com/post", "article", {
      fetchFn: mockFetch,
    });

    const init = mockFetch.mock.calls[0]?.[1] as
      | (RequestInit & { dispatcher?: unknown })
      | undefined;
    expect(init).toBeDefined();
    expect(init?.dispatcher).toBeUndefined();
  });

  it("does NOT attach a dispatcher when WEB_HTTP_PROXY is unset (REQ-005)", async () => {
    vi.stubEnv("WEB_HTTP_PROXY", "");

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html></html>"),
    } as unknown as Response);

    await fetchStatic("https://example.com/post", "article");

    const init = spy.mock.calls[0]?.[1] as
      | (RequestInit & { dispatcher?: unknown })
      | undefined;
    expect(init).toBeDefined();
    expect(init?.dispatcher).toBeUndefined();
  });

  it("still aborts/throws with the proxy dispatcher present (REQ-010, EDGE-003)", async () => {
    vi.stubEnv("WEB_HTTP_PROXY", "http://u:p@h:1");

    const ac = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

    await expect(
      fetchStatic("https://example.com/post", "article", {
        signal: ac.signal,
      }),
    ).rejects.toThrow("aborted");

    const init = spy.mock.calls[0]?.[1] as
      | (RequestInit & { dispatcher?: unknown; signal?: AbortSignal })
      | undefined;
    expect(init?.dispatcher).toBeTypeOf("object");
    expect(init?.signal).toBe(ac.signal);
  });
});
