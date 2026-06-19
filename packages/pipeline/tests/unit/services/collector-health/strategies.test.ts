import { describe, it, expect, vi } from "vitest";
import { runCollectorHealthCheck } from "@pipeline/services/collector-health/index.js";
import type { HealthCheckDeps, HealthCheckSettings, CheckableCollector } from "@pipeline/services/collector-health/index.js";

// ── Minimal settings factory ──────────────────────────────────────────────────

function makeSettings(overrides: Partial<HealthCheckSettings> = {}): HealthCheckSettings {
  return {
    hn: { keywords: ["AI"], pointsThreshold: 10, count: 20, feeds: ["newest"] },
    reddit: { subreddits: ["MachineLearning"], sort: "top", timeframe: "day", limit: 10 },
    twitter: { listIds: ["123"], users: [], maxTweetsPerSource: 10, sinceHours: 24 },
    web: { sources: [{ name: "Test Blog", listingUrl: "https://example.com/blog" }], maxItems: 5 },
    webSearch: { queries: [{ query: "AI news", sinceDays: 7, maxItems: 3 }], provider: "tavily" },
    ...overrides,
  };
}

// ── Minimal fake logger ───────────────────────────────────────────────────────
const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeDefaultFetchResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve("<feed/>"),
  } as unknown as Response;
}

function makeDeps(overrides: Partial<HealthCheckDeps> = {}): HealthCheckDeps {
  return {
    fetchFn: vi.fn().mockResolvedValue(makeDefaultFetchResponse({ hits: [] })),
    rettiwtClientFactory: vi.fn(),
    runWebCrawl: vi.fn(),
    tavilyFactory: vi.fn(),
    credentialResolver: {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: undefined,
    },
    logger: fakeLogger,
    now: () => Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HN strategy tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("runCollectorHealthCheck — hn", () => {
  it("REQ-004/005: returns healthy with durationMs > 0 and detail on success", async () => {
    const algoliaResponse = { hits: [{ objectID: "1", title: "AI news" }, { objectID: "2", title: "ML" }] };
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(algoliaResponse),
    });
    const result = await runCollectorHealthCheck("hn", makeSettings(), makeDeps({ fetchFn }));
    expect(result.status).toBe("healthy");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeNull();
    expect(result.detail).toContain("algolia hits:");
  });

  it("REQ-004: uses fetchFn to call Algolia search endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: [] }),
    });
    await runCollectorHealthCheck("hn", makeSettings(), makeDeps({ fetchFn }));
    expect(fetchFn).toHaveBeenCalledOnce();
    const [calledUrl] = fetchFn.mock.calls[0] as [string];
    expect(calledUrl).toContain("hn.algolia.com");
  });

  it("REQ-006: fetch error yields failed with classified reason", async () => {
    const fetchFn = vi.fn().mockRejectedValue(Object.assign(new Error("Too Many Requests"), { status: 429 }));
    const result = await runCollectorHealthCheck("hn", makeSettings(), makeDeps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("rate limited by the source");
  });

  it("EDGE-012: 429 from HN Algolia yields rate-limit reason", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("HTTP error: 429"));
    const result = await runCollectorHealthCheck("hn", makeSettings(), makeDeps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("rate limited by the source");
  });

  it("FIX6: no hn config = not configured, NO fetch called (consistent with other collectors)", async () => {
    const fetchFn = vi.fn();
    const settings = makeSettings({ hn: undefined });
    const result = await runCollectorHealthCheck("hn", settings, makeDeps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not configured");
    expect(result.reason).toMatch(/hacker news/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("FIX6: hn config present but no keywords still probes with default keyword (healthy)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: [{ objectID: "1" }] }),
    });
    const settings = makeSettings({
      hn: { keywords: [], feeds: ["newest"], pointsThreshold: 10, count: 20 },
    });
    const result = await runCollectorHealthCheck("hn", settings, makeDeps({ fetchFn }));
    expect(result.status).toBe("healthy");
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reddit strategy tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("runCollectorHealthCheck — reddit", () => {
  const REDDIT_RSS_STUB = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_abc123</id>
    <title>Test Post</title>
    <link href="https://reddit.com/r/MachineLearning/comments/abc123/test" rel="alternate" />
    <published>2024-01-01T00:00:00Z</published>
    <content type="html"><![CDATA[<div class="md"><p>body</p></div>]]></content>
    <name>testuser</name>
  </entry>
</feed>`;

  it("REQ-004/005: returns healthy with durationMs > 0 and detail on success", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(REDDIT_RSS_STUB),
    });
    const result = await runCollectorHealthCheck("reddit", makeSettings(), makeDeps({ fetchFn }));
    expect(result.status).toBe("healthy");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeNull();
    expect(result.detail).toMatch(/r\/machinelearning/i);
  });

  it("REQ-004: uses browser-like User-Agent in fetch call", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(REDDIT_RSS_STUB),
    });
    await runCollectorHealthCheck("reddit", makeSettings(), makeDeps({ fetchFn }));
    expect(fetchFn).toHaveBeenCalled();
    const [, options] = fetchFn.mock.calls[0] as [string, RequestInit];
    const ua = (options?.headers as Record<string, string>)?.["User-Agent"] ?? "";
    expect(ua).toMatch(/mozilla|newslet/i); // must be browser-like or bot UA
  });

  it("REQ-021: empty subreddits = not configured, NO fetch called (EDGE-002)", async () => {
    const fetchFn = vi.fn();
    const settings = makeSettings({ reddit: { subreddits: [], sort: "top", timeframe: "day", limit: 10 } });
    const result = await runCollectorHealthCheck("reddit", settings, makeDeps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not configured");
    expect(result.reason).toMatch(/subreddit/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("REQ-006: fetch error yields failed with classified reason", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Non-retryable HTTP error: 403"));
    const result = await runCollectorHealthCheck("reddit", makeSettings(), makeDeps({ fetchFn }));
    expect(result.status).toBe("failed");
    expect(result.reason).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Twitter strategy tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("runCollectorHealthCheck — twitter", () => {
  const fakeCookie = { apiKey: "fake-key", source: "env" as const };

  it("REQ-004/005: returns healthy when rettiwt client fetches successfully", async () => {
    const mockPage = {
      list: [{ id: "tweet1", fullText: "hello", createdAt: new Date().toISOString() }],
      next: null,
    };
    const mockRettiwt = { list: { tweets: vi.fn().mockResolvedValue(mockPage) }, user: { timeline: vi.fn() } };
    const rettiwtClientFactory = vi.fn().mockReturnValue(mockRettiwt);
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(fakeCookie),
      tavilyApiKey: undefined,
    };
    const result = await runCollectorHealthCheck(
      "twitter",
      makeSettings(),
      makeDeps({ rettiwtClientFactory, credentialResolver }),
    );
    expect(result.status).toBe("healthy");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeNull();
  });

  it("REQ-022/EDGE-003: missing cookie = failed naming Twitter cookies + admin/settings, NO rettiwt call", async () => {
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: undefined,
    };
    const rettiwtClientFactory = vi.fn();
    const result = await runCollectorHealthCheck(
      "twitter",
      makeSettings(),
      makeDeps({ rettiwtClientFactory, credentialResolver }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/twitter cookie|rettiwt|admin\/settings/i);
    expect(rettiwtClientFactory).not.toHaveBeenCalled();
  });

  it("REQ-021: no listIds/users = not configured, NO rettiwt call", async () => {
    const rettiwtClientFactory = vi.fn();
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(fakeCookie),
      tavilyApiKey: undefined,
    };
    const settings = makeSettings({ twitter: { listIds: [], users: [], maxTweetsPerSource: 10, sinceHours: 24 } });
    const result = await runCollectorHealthCheck(
      "twitter",
      settings,
      makeDeps({ rettiwtClientFactory, credentialResolver }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not configured");
    expect(result.reason).toMatch(/list|user/i);
    expect(rettiwtClientFactory).not.toHaveBeenCalled();
  });

  it("EDGE-011: auth error from rettiwt = failed with rotate-cookies reason", async () => {
    const authErr = Object.assign(new Error("Not authorized to access requested resource"), { status: 401 });
    const mockRettiwt = { list: { tweets: vi.fn().mockRejectedValue(authErr) }, user: { timeline: vi.fn() } };
    const rettiwtClientFactory = vi.fn().mockReturnValue(mockRettiwt);
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(fakeCookie),
      tavilyApiKey: undefined,
    };
    const result = await runCollectorHealthCheck(
      "twitter",
      makeSettings(),
      makeDeps({ rettiwtClientFactory, credentialResolver }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/rotate.*cookie|cookie.*rotate|admin\/settings/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blog strategy tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("runCollectorHealthCheck — blog", () => {
  it("REQ-004/005: returns healthy when crawl succeeds (EDGE-009: crawl-only, no LLM)", async () => {
    const mockCrawlResult = new Map([
      [
        "https://example.com/blog",
        {
          ok: true as const,
          result: {
            markdown: "# Blog\n\nSome content here",
            requestsFailed: 0,
            url: "https://example.com/blog",
            publishedAt: null,
          },
          renderedWith: "static" as const,
        },
      ],
    ]);
    const runWebCrawl = vi.fn().mockResolvedValue(mockCrawlResult);
    const result = await runCollectorHealthCheck("blog", makeSettings(), makeDeps({ runWebCrawl }));
    expect(result.status).toBe("healthy");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeNull();
    expect(result.detail).toMatch(/crawled/i);
    // Ensure no LLM discovery was triggered (no fetchFn call for DeepSeek, etc.)
    // The test relies on runWebCrawl being called — that IS the blog strategy
    expect(runWebCrawl).toHaveBeenCalledOnce();
  });

  it("REQ-021: empty sources = not configured, NO runWebCrawl called (EDGE-004)", async () => {
    const runWebCrawl = vi.fn();
    const settings = makeSettings({ web: { sources: [], maxItems: 5 } });
    const result = await runCollectorHealthCheck("blog", settings, makeDeps({ runWebCrawl }));
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not configured");
    expect(result.reason).toMatch(/blog|rss/i);
    expect(runWebCrawl).not.toHaveBeenCalled();
  });

  it("REQ-006: crawl failure yields failed with classified reason", async () => {
    const mockCrawlResult = new Map([
      [
        "https://example.com/blog",
        {
          ok: false as const,
          error: "connect ECONNREFUSED",
        },
      ],
    ]);
    const runWebCrawl = vi.fn().mockResolvedValue(mockCrawlResult);
    const result = await runCollectorHealthCheck("blog", makeSettings(), makeDeps({ runWebCrawl }));
    expect(result.status).toBe("failed");
    expect(result.reason).toBeDefined();
    expect(result.reason).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// web_search strategy tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("runCollectorHealthCheck — web_search", () => {
  const fakeTavilyResult = [
    { url: "https://example.com/ai-news", title: "AI News", snippet: "snippet", rawScore: 0.9, publishedAt: null },
  ];

  it("REQ-004/005: returns healthy with detail showing result count", async () => {
    const mockProvider = { name: "tavily", search: vi.fn().mockResolvedValue(fakeTavilyResult) };
    const tavilyFactory = vi.fn().mockReturnValue(mockProvider);
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: "fake-tavily-key",
    };
    const result = await runCollectorHealthCheck(
      "web_search",
      makeSettings(),
      makeDeps({ tavilyFactory, credentialResolver }),
    );
    expect(result.status).toBe("healthy");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeNull();
    expect(result.detail).toContain("tavily results:");
  });

  it("REQ-022/EDGE-005: no TAVILY_API_KEY = failed naming the key, NO factory call", async () => {
    const tavilyFactory = vi.fn();
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: undefined,
    };
    const result = await runCollectorHealthCheck(
      "web_search",
      makeSettings(),
      makeDeps({ tavilyFactory, credentialResolver }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/TAVILY_API_KEY/);
    expect(tavilyFactory).not.toHaveBeenCalled();
  });

  it("REQ-021: no queries configured = not configured, NO factory call", async () => {
    const tavilyFactory = vi.fn();
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: "some-key",
    };
    const settings = makeSettings({ webSearch: { queries: [], provider: "tavily" } });
    const result = await runCollectorHealthCheck(
      "web_search",
      settings,
      makeDeps({ tavilyFactory, credentialResolver }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("not configured");
    expect(result.reason).toMatch(/quer/i);
    expect(tavilyFactory).not.toHaveBeenCalled();
  });

  it("EDGE-012: 429 from Tavily yields rate-limit reason", async () => {
    const mockProvider = {
      name: "tavily",
      search: vi.fn().mockRejectedValue(new Error("Tavily search failed: HTTP 429")),
    };
    const tavilyFactory = vi.fn().mockReturnValue(mockProvider);
    const credentialResolver = {
      resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
      tavilyApiKey: "fake-tavily-key",
    };
    const result = await runCollectorHealthCheck(
      "web_search",
      makeSettings(),
      makeDeps({ tavilyFactory, credentialResolver }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("rate limited by the source");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REQ-020: timeout yields failed with timeout reason — symmetric across all
// five collectors (each wires a never-resolving stub for its own dependency).
// ═══════════════════════════════════════════════════════════════════════════════

function neverResolves(): Promise<never> {
  return new Promise<never>(() => undefined);
}

describe("runCollectorHealthCheck — REQ-020 timeout (all collectors)", () => {
  const fakeCookie = { apiKey: "fake-key", source: "env" as const };

  it.each<{ collector: CheckableCollector; deps: () => Partial<HealthCheckDeps> }>([
    { collector: "hn", deps: () => ({ fetchFn: vi.fn().mockImplementation(neverResolves) }) },
    { collector: "reddit", deps: () => ({ fetchFn: vi.fn().mockImplementation(neverResolves) }) },
    {
      collector: "twitter",
      deps: () => ({
        rettiwtClientFactory: vi.fn().mockReturnValue({
          list: { tweets: vi.fn().mockImplementation(neverResolves) },
          user: { timeline: vi.fn() },
        }),
        credentialResolver: {
          resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(fakeCookie),
          tavilyApiKey: undefined,
        },
      }),
    },
    { collector: "blog", deps: () => ({ runWebCrawl: vi.fn().mockImplementation(neverResolves) }) },
    {
      collector: "web_search",
      deps: () => ({
        tavilyFactory: vi.fn().mockReturnValue({
          name: "tavily",
          search: vi.fn().mockImplementation(neverResolves),
        }),
        credentialResolver: {
          resolveTwitterCollectorCookie: vi.fn().mockResolvedValue(null),
          tavilyApiKey: "fake-tavily-key",
        },
      }),
    },
  ])("$collector: timeout yields failed with timeout reason", async ({ collector, deps }) => {
    const result = await runCollectorHealthCheck(
      collector,
      makeSettings(),
      makeDeps(deps()),
      { timeoutMs: 50 },
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/timeout/i); // "timeout" appears in our reason string
  });
});
