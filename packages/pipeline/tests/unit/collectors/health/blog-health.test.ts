import { describe, expect, it, vi } from "vitest";
import { checkBlogHealth, classifyBlogError } from "@pipeline/collectors/health/blog-health.js";

describe("checkBlogHealth", () => {
  const validSource = { name: "Test Blog", listingUrl: "https://blog.example.com" };
  const mockModel = { modelId: "deepseek-chat" };

  it("returns skipped when no sources are configured", async () => {
    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([]),
      getModel: vi.fn().mockReturnValue(mockModel),
    });

    expect(result.collector).toBe("blog");
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("sources");
  });

  it("returns skipped when DEEPSEEK_API_KEY is not set", async () => {
    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([validSource]),
      getModel: vi.fn().mockReturnValue(undefined),
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("API key");
  });

  it("returns healthy when crawl + discovery finds posts", async () => {
    const runCrawl = vi.fn().mockResolvedValue(
      new Map([["https://blog.example.com", { ok: true, result: { markdown: "# Hello", structuredData: null } }]]),
    );
    const discoverPosts = vi.fn().mockResolvedValue([
      { url: "https://blog.example.com/post-1", title: "Post 1", published_at: "2026-06-01" },
    ]);

    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([validSource]),
      getModel: vi.fn().mockReturnValue(mockModel),
      runCrawl,
      discoverPosts,
    });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(1);
  });

  it("returns healthy with multiple discovered posts", async () => {
    const runCrawl = vi.fn().mockResolvedValue(
      new Map([["https://blog.example.com", { ok: true, result: { markdown: "# Hello", structuredData: null } }]]),
    );
    const discoverPosts = vi.fn().mockResolvedValue([
      { url: "https://blog.example.com/p1", title: "P1", published_at: "2026-06-01" },
      { url: "https://blog.example.com/p2", title: "P2", published_at: "2026-06-02" },
    ]);

    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([validSource]),
      getModel: vi.fn().mockReturnValue(mockModel),
      runCrawl,
      discoverPosts,
    });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(2);
  });

  it("returns failed when crawl fails for the first source", async () => {
    const runCrawl = vi.fn().mockResolvedValue(
      new Map([["https://blog.example.com", { ok: false, error: "ETIMEDOUT" }]]),
    );

    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([validSource]),
      getModel: vi.fn().mockReturnValue(mockModel),
      runCrawl,
      discoverPosts: vi.fn(),
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("timed out");
  });

  it("returns failed when discovery returns no posts", async () => {
    const runCrawl = vi.fn().mockResolvedValue(
      new Map([["https://blog.example.com", { ok: true, result: { markdown: "# Empty", structuredData: null } }]]),
    );

    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([validSource]),
      getModel: vi.fn().mockReturnValue(mockModel),
      runCrawl,
      discoverPosts: vi.fn().mockResolvedValue([]),
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no posts");
  });

  it("returns failed when discovery throws", async () => {
    const runCrawl = vi.fn().mockResolvedValue(
      new Map([["https://blog.example.com", { ok: true, result: { markdown: "# Hello", structuredData: null } }]]),
    );
    const discoverPosts = vi.fn().mockRejectedValue(new Error("LLM API error"));

    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue([validSource]),
      getModel: vi.fn().mockReturnValue(mockModel),
      runCrawl,
      discoverPosts,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("LLM");
  });

  it("returns healthy using the first configured source with multiple sources", async () => {
    const sources = [
      { name: "Blog A", listingUrl: "https://a.example.com" },
      { name: "Blog B", listingUrl: "https://b.example.com" },
    ];
    const runCrawl = vi.fn().mockImplementation((jobs) => {
      const map = new Map();
      for (const job of jobs) {
        map.set(job.url, { ok: true, result: { markdown: "# Hello", structuredData: null } });
      }
      return map;
    });
    const discoverPosts = vi.fn().mockResolvedValue([
      { url: "https://a.example.com/p1", title: "P1", published_at: "2026-06-01" },
    ]);

    const result = await checkBlogHealth({
      getSources: vi.fn().mockReturnValue(sources),
      getModel: vi.fn().mockReturnValue(mockModel),
      runCrawl,
      discoverPosts,
    });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(1);
  });
});

describe("classifyBlogError", () => {
  it("classifies LLM API errors", () => {
    const msg = classifyBlogError(new Error("LLM API error: 402 Payment Required"));
    expect(msg).toContain("LLM");
  });

  it("classifies network errors", () => {
    const msg = classifyBlogError(new Error("ENOTFOUND blog.example.com"));
    expect(msg).toContain("network");
  });

  it("classifies timeout errors", () => {
    const msg = classifyBlogError(new Error("timeout of 15000ms exceeded"));
    expect(msg).toContain("timed out");
  });

  it("returns raw message for unknown errors", () => {
    const msg = classifyBlogError(new Error("something else"));
    expect(msg).toBe("something else");
  });
});
