import { describe, expect, it, vi } from "vitest";
import { checkWebSearchHealth, classifyWebSearchError } from "@pipeline/collectors/health/web-search-health.js";
import type { WebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";

describe("checkWebSearchHealth", () => {
  it("returns skipped when no provider is configured", async () => {
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(undefined) });

    expect(result.collector).toBe("web_search");
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("API key");
  });

  it("returns healthy when search returns at least one result", async () => {
    const provider: WebSearchProvider = {
      name: "tavily",
      search: vi.fn().mockResolvedValue([
        { url: "https://example.com", title: "AI News", snippet: "Latest AI news", publishedAt: null },
      ]),
    };
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(provider) });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(1);
  });

  it("returns healthy with multiple results", async () => {
    const provider: WebSearchProvider = {
      name: "tavily",
      search: vi.fn().mockResolvedValue([
        { url: "https://a.com", title: "A", snippet: "A", publishedAt: null },
        { url: "https://b.com", title: "B", snippet: "B", publishedAt: null },
      ]),
    };
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(provider) });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(2);
  });

  it("returns failed when search returns empty results", async () => {
    const provider: WebSearchProvider = {
      name: "tavily",
      search: vi.fn().mockResolvedValue([]),
    };
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(provider) });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no results");
  });

  it("returns failed when search results lack urls", async () => {
    const provider: WebSearchProvider = {
      name: "tavily",
      search: vi.fn().mockResolvedValue([
        { title: "No URL", snippet: "missing url", publishedAt: null },
      ]),
    };
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(provider) });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no results");
  });

  it("returns failed when search throws an error", async () => {
    const provider: WebSearchProvider = {
      name: "tavily",
      search: vi.fn().mockRejectedValue(new Error("API rate limit exceeded")),
    };
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(provider) });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("rate");
  });

  it("returns failed when search throws a network error", async () => {
    const provider: WebSearchProvider = {
      name: "tavily",
      search: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    };
    const result = await checkWebSearchHealth({ getProvider: vi.fn().mockReturnValue(provider) });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("network");
  });
});

describe("classifyWebSearchError", () => {
  it("classifies 401/403 as auth errors", () => {
    const msg = classifyWebSearchError(new Error("401 Unauthorized"));
    expect(msg).toContain("API key");
  });

  it("classifies rate limits", () => {
    const msg = classifyWebSearchError(new Error("rate limit exceeded"));
    expect(msg).toContain("rate");
  });

  it("classifies network errors", () => {
    const msg = classifyWebSearchError(new Error("ENOTFOUND api.tavily.com"));
    expect(msg).toContain("network");
  });

  it("returns raw message for unknown errors", () => {
    const msg = classifyWebSearchError(new Error("something else"));
    expect(msg).toBe("something else");
  });
});
