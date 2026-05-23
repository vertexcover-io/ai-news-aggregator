import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPageStatic } from "@shared/services/static-page-fetcher.js";

type FetchFn = typeof globalThis.fetch;
const originalFetch = globalThis.fetch;

function setFetch(impl: FetchFn): void {
  globalThis.fetch = impl;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

describe("fetchPageStatic", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    restoreFetch();
    vi.useRealTimers();
  });

  it("returns html + finalUrl on a 200 text/html response", async () => {
    const mockFetch = vi.fn((_input: RequestInfo | URL) => {
      const res = htmlResponse("<html><head><title>hi</title></head><body>ok</body></html>");
      Object.defineProperty(res, "url", { value: "https://example.com/article" });
      return Promise.resolve(res);
    }) as unknown as FetchFn;
    setFetch(mockFetch);

    const result = await fetchPageStatic("https://example.com/article", {});
    expect("html" in result).toBe(true);
    if ("html" in result) {
      expect(result.html).toContain("<title>hi</title>");
      expect(result.finalUrl).toBe("https://example.com/article");
    }
  });

  it("returns http_4xx on 404", async () => {
    const mockFetch = vi.fn(() => {
      const res = new Response("not found", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(res, "url", { value: "https://example.com/missing" });
      return Promise.resolve(res);
    }) as unknown as FetchFn;
    setFetch(mockFetch);

    const result = await fetchPageStatic("https://example.com/missing", {});
    expect(result).toEqual({ error: "http_4xx" });
  });

  it("returns http_5xx on 500", async () => {
    const mockFetch = vi.fn(() => {
      const res = new Response("boom", {
        status: 500,
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(res, "url", { value: "https://example.com/x" });
      return Promise.resolve(res);
    }) as unknown as FetchFn;
    setFetch(mockFetch);

    const result = await fetchPageStatic("https://example.com/x", {});
    expect(result).toEqual({ error: "http_5xx" });
  });

  it("returns timeout when fetch never resolves before opts.timeoutMs", async () => {
    const mockFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }) as unknown as FetchFn;
    setFetch(mockFetch);

    const result = await fetchPageStatic("https://example.com/slow", { timeoutMs: 50 });
    expect(result).toEqual({ error: "timeout" });
  });

  it("returns non_html for non-text/html content-type", async () => {
    const mockFetch = vi.fn(() => {
      const res = new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(res, "url", { value: "https://example.com/api" });
      return Promise.resolve(res);
    }) as unknown as FetchFn;
    setFetch(mockFetch);

    const result = await fetchPageStatic("https://example.com/api", {});
    expect(result).toEqual({ error: "non_html" });
  });

  it("returns ssrf without ever invoking fetch when the URL targets a private host", async () => {
    const mockFetch = vi.fn() as unknown as FetchFn;
    setFetch(mockFetch);

    const result = await fetchPageStatic("http://localhost/", {});
    expect(result).toEqual({ error: "ssrf" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
