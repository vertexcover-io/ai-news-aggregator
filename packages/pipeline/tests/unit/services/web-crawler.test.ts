import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CrawlJob, CrawlResult } from "@pipeline/services/web-crawler.js";

// ---------------------------------------------------------------------------
// Stub AdaptivePlaywrightCrawler — we capture the options and handler closures
// so tests can simulate per-request flows without real Chromium.
// ---------------------------------------------------------------------------

interface CapturedCrawlerOptions {
  maxConcurrency?: number;
  maxRequestRetries?: number;
  requestHandlerTimeoutSecs?: number;
  sameDomainDelaySecs?: number;
  respectRobotsTxtFile?: boolean;
  renderingTypeDetectionRatio?: number;
  proxyConfiguration?: { proxyUrls: string[] };
  requestHandler?: (ctx: unknown) => Promise<void>;
  failedRequestHandler?: (ctx: unknown, error: Error) => void;
  resultChecker?: (result: unknown) => boolean;
}

interface MockCrawlerInstance {
  options: CapturedCrawlerOptions;
  runRequests: { url: string; userData: Record<string, unknown> }[];
  teardownCalled: boolean;
  stats: {
    state: {
      requestsFinished: number;
      requestsFailed: number;
      requestsRetries: number;
      httpOnlyRequestHandlerRuns?: number;
      browserRequestHandlerRuns?: number;
      renderingTypeMispredictions?: number;
    };
  };
  run: ReturnType<typeof vi.fn>;
  teardown: ReturnType<typeof vi.fn>;
}

let lastMockInstance: MockCrawlerInstance | null = null;

/** Unwrap lastMockInstance for assertions; throws if null so we get a clear message. */
function getInstance(): MockCrawlerInstance {
  if (lastMockInstance === null) throw new Error("No crawler instance was constructed");
  return lastMockInstance;
}

vi.mock("crawlee", () => {
  return {
    Configuration: vi.fn().mockImplementation(() => ({})),
    ProxyConfiguration: vi.fn().mockImplementation(
      (config: { proxyUrls: string[] }) => ({ proxyUrls: config.proxyUrls }),
    ),
    AdaptivePlaywrightCrawler: vi.fn().mockImplementation(
      (options: CapturedCrawlerOptions) => {
        const instance: MockCrawlerInstance = {
          options,
          runRequests: [],
          teardownCalled: false,
          stats: {
            state: {
              requestsFinished: 2,
              requestsFailed: 0,
              requestsRetries: 1,
              httpOnlyRequestHandlerRuns: 2,
              browserRequestHandlerRuns: 0,
              renderingTypeMispredictions: 0,
            },
          },
          run: vi.fn().mockImplementation(
            (
              requests: { url: string; userData: Record<string, unknown> }[],
            ) => {
              instance.runRequests = requests;
              return Promise.resolve();
            },
          ),
          teardown: vi.fn().mockResolvedValue(undefined),
        };
        lastMockInstance = instance;
        return instance;
      },
    ),
  };
});

// ---------------------------------------------------------------------------
// Helpers — build minimal Cheerio-like parseWithCheerio response
// ---------------------------------------------------------------------------

function makeStaticContext(
  url: string,
  html: string,
  userData: Record<string, unknown>,
  statusCode = 200,
): {
  request: { url: string; loadedUrl: string; userData: Record<string, unknown> };
  response: { statusCode: number };
  parseWithCheerio: () => Promise<{ html: () => string }>;
  pushData: ReturnType<typeof vi.fn>;
} {
  return {
    request: { url, loadedUrl: url, userData },
    response: { statusCode },
    parseWithCheerio: vi.fn().mockResolvedValue({
      html: () => html,
    }),
    pushData: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFailedContext(url: string): { request: { url: string } } {
  return { request: { url } };
}

// Import under test — must come AFTER vi.mock so mock is established
const { runWebCrawl, crawlWithProxyFallback } = await import("@pipeline/services/web-crawler.js");

describe("runWebCrawl", () => {
  beforeEach(() => {
    lastMockInstance = null;
    delete process.env.WEB_CRAWLER_CONCURRENCY;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // REQ-08: empty jobs short-circuit
  // -------------------------------------------------------------------------
  it("returns an empty Map and never constructs a crawler when jobs is empty", async () => {
    const result = await runWebCrawl([]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(lastMockInstance).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Defensive guard: a malformed URL must never reach crawler.run() — Crawlee's
  // addRequests validates the whole batch atomically, so one bad URL would abort
  // the entire crawl. We filter invalid URLs out and mark them as failures.
  // -------------------------------------------------------------------------
  it("drops invalid URLs from the batch and never passes them to crawler.run()", async () => {
    const jobs: CrawlJob[] = [
      { kind: "detail", sourceName: "s", postUrl: "/blog/relative", url: "/blog/relative" },
      { kind: "detail", sourceName: "s", postUrl: "https://ok.com/p", url: "https://ok.com/p" },
      { kind: "listing", sourceName: "s", url: "" },
    ];

    const result = await runWebCrawl(jobs);

    const passed = getInstance().runRequests.map((r) => r.url);
    expect(passed).toEqual(["https://ok.com/p"]);

    const relative = result.get("/blog/relative");
    expect(relative?.ok).toBe(false);
    if (relative && !relative.ok) expect(relative.error).toBe("invalid-url");
    const empty = result.get("");
    expect(empty?.ok).toBe(false);
  });

  it("returns an empty Map without constructing a crawler when all URLs are invalid", async () => {
    const jobs: CrawlJob[] = [
      { kind: "detail", sourceName: "s", postUrl: "/a", url: "/a" },
      { kind: "listing", sourceName: "s", url: "mailto:x@y.com" },
    ];

    const result = await runWebCrawl(jobs);

    expect(lastMockInstance).toBeNull();
    expect(result.get("/a")?.ok).toBe(false);
    expect(result.get("mailto:x@y.com")?.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // REQ-08: crawler config options
  // -------------------------------------------------------------------------
  it("constructs crawler with required config options", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "test-source", url: "https://example.com" },
    ];
    await runWebCrawl(jobs);

    const opts = getInstance().options;
    expect(opts.maxRequestRetries).toBe(3);
    expect(opts.requestHandlerTimeoutSecs).toBe(30);
    expect(opts.sameDomainDelaySecs).toBe(1);
    expect(opts.respectRobotsTxtFile).toBe(true);
    expect(opts.renderingTypeDetectionRatio).toBe(0.1);
  });

  // -------------------------------------------------------------------------
  // REQ-08: default maxConcurrency is 4
  // -------------------------------------------------------------------------
  it("uses maxConcurrency 4 when no env var or override is set", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];
    await runWebCrawl(jobs);

    expect(getInstance().options.maxConcurrency).toBe(4);
  });

  // -------------------------------------------------------------------------
  // REQ-08: WEB_CRAWLER_CONCURRENCY env override
  // -------------------------------------------------------------------------
  it("reads maxConcurrency from WEB_CRAWLER_CONCURRENCY env var", async () => {
    process.env.WEB_CRAWLER_CONCURRENCY = "8";
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];
    await runWebCrawl(jobs);

    expect(getInstance().options.maxConcurrency).toBe(8);
  });

  // -------------------------------------------------------------------------
  // REQ-08: maxConcurrency from opts overrides env var
  // -------------------------------------------------------------------------
  it("uses opts.maxConcurrency when explicitly provided, ignoring env var", async () => {
    process.env.WEB_CRAWLER_CONCURRENCY = "8";
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];
    await runWebCrawl(jobs, { maxConcurrency: 2 });

    expect(getInstance().options.maxConcurrency).toBe(2);
  });

  // -------------------------------------------------------------------------
  // REQ-08: per-job userData encoding — listing kind
  // -------------------------------------------------------------------------
  it("encodes listing job with kind=listing, mode=listing, no postUrl in userData", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "my-blog", url: "https://blog.com" },
    ];
    await runWebCrawl(jobs);

    const { runRequests } = getInstance();
    expect(runRequests).toHaveLength(1);
    const req = runRequests[0];
    if (!req) throw new Error("no request");
    const ud = req.userData as { kind: string; sourceName: string; mode: string; postUrl?: string };
    expect(req.url).toBe("https://blog.com");
    expect(ud.kind).toBe("listing");
    expect(ud.sourceName).toBe("my-blog");
    expect(ud.mode).toBe("listing");
    expect(ud.postUrl).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // REQ-08: per-job userData encoding — detail kind
  // -------------------------------------------------------------------------
  it("encodes detail job with kind=detail, mode=article, postUrl in userData", async () => {
    const jobs: CrawlJob[] = [
      {
        kind: "detail",
        sourceName: "my-blog",
        postUrl: "https://blog.com/post-1",
        url: "https://blog.com/post-1",
      },
    ];
    await runWebCrawl(jobs);

    const req = getInstance().runRequests[0];
    if (!req) throw new Error("no request");
    const ud = req.userData as { kind: string; mode: string; postUrl: string };
    expect(ud.kind).toBe("detail");
    expect(ud.mode).toBe("article");
    expect(ud.postUrl).toBe("https://blog.com/post-1");
  });

  // -------------------------------------------------------------------------
  // REQ-08: requestHandler success path — calls convert and stores result
  // -------------------------------------------------------------------------
  it("requestHandler invocation: calls convert with page HTML and stores success result", async () => {
    const url = "https://example.com";
    const html =
      "<html><head><title>My Article</title></head><body><p>" +
      "a".repeat(300) +
      "</p></body></html>";

    const jobs: CrawlJob[] = [{ kind: "listing", sourceName: "src", url }];

    // Start the crawl — the mock run() resolves immediately but we need to
    // drive the requestHandler closure ourselves to simulate a real request.
    const crawlPromise = runWebCrawl(jobs);

    const { options } = getInstance();
    const handler = options.requestHandler;
    if (!handler) throw new Error("requestHandler not set");

    const ctx = makeStaticContext(url, html, {
      kind: "listing",
      sourceName: "src",
      mode: "listing",
    });
    await handler(ctx);

    const result = await crawlPromise;
    const entry: CrawlResult | undefined = result.get(url);
    if (!entry) throw new Error("no entry for url");
    expect(entry.ok).toBe(true);
    if (entry.ok) {
      expect(entry.result.markdown).toBeTruthy();
      expect(entry.renderedWith).toBe("static");
    }
  });

  // -------------------------------------------------------------------------
  // REQ-08: failedRequestHandler — records truncated error
  // -------------------------------------------------------------------------
  it("failedRequestHandler invocation: stores failure with error string", async () => {
    const url = "https://failing.com";
    const jobs: CrawlJob[] = [{ kind: "listing", sourceName: "src", url }];

    const crawlPromise = runWebCrawl(jobs);

    const failedHandler = getInstance().options.failedRequestHandler;
    if (!failedHandler) throw new Error("failedRequestHandler not set");

    failedHandler(makeFailedContext(url), new Error("connection refused"));

    const result = await crawlPromise;
    const entry = result.get(url);
    if (!entry) throw new Error("no entry");
    expect(entry.ok).toBe(false);
    if (!entry.ok) {
      expect(entry.error).toBe("connection refused");
    }
  });

  // -------------------------------------------------------------------------
  // REQ-08: failedRequestHandler — truncates error to 200 chars
  // -------------------------------------------------------------------------
  it("failedRequestHandler truncates error message to exactly 200 chars", async () => {
    const url = "https://truncate.com";
    const jobs: CrawlJob[] = [{ kind: "listing", sourceName: "src", url }];

    const crawlPromise = runWebCrawl(jobs);

    const failedHandler = getInstance().options.failedRequestHandler;
    if (!failedHandler) throw new Error("failedRequestHandler not set");

    failedHandler(makeFailedContext(url), new Error("x".repeat(300)));

    const result = await crawlPromise;
    const entry = result.get(url);
    if (!entry) throw new Error("no entry");
    expect(entry.ok).toBe(false);
    if (!entry.ok) {
      expect(entry.error.length).toBe(200);
      expect(entry.error.endsWith("...")).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // REQ-08 EDGE-08c: signal abort — teardown called, unfinished → "cancelled"
  //
  // We configure the mock factory to produce a slow run() for this test,
  // then abort the signal and let run() resolve. We verify teardown was called
  // and the job that was never processed is marked "cancelled".
  // -------------------------------------------------------------------------
  it("calls teardown when signal is aborted and marks unfinished jobs as cancelled", async () => {
    const url = "https://slow.com";
    const jobs: CrawlJob[] = [{ kind: "listing", sourceName: "src", url }];

    const ac = new AbortController();

    // Build the deferred before runWebCrawl so we control when run() resolves.
    let runResolve!: () => void;
    const slowRun = new Promise<void>((res) => {
      runResolve = res;
    });

    const { AdaptivePlaywrightCrawler } = await import("crawlee");
    const MockCtor = vi.mocked(AdaptivePlaywrightCrawler);

    MockCtor.mockImplementationOnce((options: CapturedCrawlerOptions) => {
      const instance: MockCrawlerInstance = {
        options,
        runRequests: [],
        teardownCalled: false,
        stats: {
          state: {
            requestsFinished: 0,
            requestsFailed: 0,
            requestsRetries: 0,
            httpOnlyRequestHandlerRuns: 0,
            browserRequestHandlerRuns: 0,
            renderingTypeMispredictions: 0,
          },
        },
        run: vi.fn().mockImplementation(
          (requests: { url: string; userData: Record<string, unknown> }[]) => {
            instance.runRequests = requests;
            return slowRun; // blocks until runResolve() is called
          },
        ),
        teardown: vi.fn().mockResolvedValue(undefined),
      };
      lastMockInstance = instance;
      return instance;
    });

    // Start the crawl — it blocks inside run()
    const crawlPromise = runWebCrawl(jobs, { signal: ac.signal });

    // Wait for the mock to be constructed and run() to start
    await Promise.resolve();
    await Promise.resolve();

    // Abort — fires the signal listener → crawler.teardown()
    ac.abort();

    // Let run() resolve naturally
    runResolve();

    const result = await crawlPromise;

    // teardown was called
    expect(getInstance().teardown).toHaveBeenCalled();

    // The URL never had its handler called → marked cancelled
    const entry = result.get(url);
    if (!entry) throw new Error("no entry");
    expect(entry.ok).toBe(false);
    if (!entry.ok) {
      expect(entry.error).toBe("cancelled");
    }
  });

  // -------------------------------------------------------------------------
  // REQ-08 EDGE-08a: a new crawler instance is created per runWebCrawl call
  // -------------------------------------------------------------------------
  it("creates a fresh crawler instance for each call to runWebCrawl", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];

    await runWebCrawl(jobs);
    const first = lastMockInstance;

    await runWebCrawl(jobs);
    const second = lastMockInstance;

    expect(first).not.toBe(second);
  });

  // -------------------------------------------------------------------------
  // REQ-17: stats are logged after run completes (verify no throw)
  // -------------------------------------------------------------------------
  it("logs crawler stats after crawler.run() resolves without throwing", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];

    await expect(runWebCrawl(jobs)).resolves.toBeInstanceOf(Map);
  });

  // -------------------------------------------------------------------------
  // REQ-NFR-02 / REQ-NFR-03: politeness + robots config
  // -------------------------------------------------------------------------
  it("sets sameDomainDelaySecs=1 and respectRobotsTxtFile=true", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];
    await runWebCrawl(jobs);

    expect(getInstance().options.sameDomainDelaySecs).toBe(1);
    expect(getInstance().options.respectRobotsTxtFile).toBe(true);
  });

  // -------------------------------------------------------------------------
  // resultChecker: healthy dataset item → true
  // -------------------------------------------------------------------------
  it("resultChecker returns true for a healthy pushed dataset item", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];
    await runWebCrawl(jobs);

    const checker = getInstance().options.resultChecker;
    if (!checker) throw new Error("resultChecker not set");

    const healthyResult = {
      datasetItems: [
        {
          item: {
            result: {
              markdown: "hello world",
              title: null,
              byline: null,
              imageUrl: null,
              textLength: 250,
            },
          },
        },
      ],
    };
    expect(checker(healthyResult)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // resultChecker: unhealthy dataset item (textLength < 200) → false
  // -------------------------------------------------------------------------
  it("resultChecker returns false for an unhealthy pushed dataset item", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "s", url: "https://a.com" },
    ];
    await runWebCrawl(jobs);

    const checker = getInstance().options.resultChecker;
    if (!checker) throw new Error("resultChecker not set");

    const unhealthyResult = {
      datasetItems: [
        {
          item: {
            result: {
              markdown: "short",
              title: null,
              byline: null,
              imageUrl: null,
              textLength: 50,
            },
          },
        },
      ],
    };
    expect(checker(unhealthyResult)).toBe(false);
  });

  // ── VS-5: level mapping for crawler.stats (REQ-002 + REQ-009) ──────────────
  describe("runLogger crawler.stats emission", () => {
    function makeFakeLogger(): {
      debug: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    } {
      return {
        debug: vi.fn().mockResolvedValue(undefined),
        info: vi.fn().mockResolvedValue(undefined),
        warn: vi.fn().mockResolvedValue(undefined),
        error: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("emits crawler.stats at info when requestsFailed === 0", async () => {
      const fakeLogger = makeFakeLogger();
      const jobs: CrawlJob[] = [
        { kind: "listing", sourceName: "s", url: "https://ok.com" },
      ];
      await runWebCrawl(jobs, { runLogger: fakeLogger });

      // Mock default has requestsFailed: 0
      expect(fakeLogger.info).toHaveBeenCalled();
      const infoCall = fakeLogger.info.mock.calls.find(
        (c) => (c[0] as { event?: string }).event === "crawler.stats",
      );
      expect(infoCall).toBeDefined();
      if (!infoCall) throw new Error("no crawler.stats info call");
      const fields = infoCall[0] as Record<string, unknown>;
      expect(fields.stage).toBe("collect");
      expect(fields.source).toBe("blog");
      expect(fields.step).toBe("crawl");
      expect(fields.requestsFailed).toBe(0);
      // Must not be at warn
      const warnCall = fakeLogger.warn.mock.calls.find(
        (c) => (c[0] as { event?: string }).event === "crawler.stats",
      );
      expect(warnCall).toBeUndefined();
    });

    it("emits crawler.stats at warn when requestsFailed > 0", async () => {
      const fakeLogger = makeFakeLogger();
      const jobs: CrawlJob[] = [
        { kind: "listing", sourceName: "s", url: "https://flaky.com" },
      ];
      const runPromise = runWebCrawl(jobs, { runLogger: fakeLogger });
      // Mutate the mock crawler's stats BEFORE the underlying run() resolves so
      // the post-run stats emission sees requestsFailed > 0.
      getInstance().stats.state.requestsFailed = 2;
      await runPromise;

      const warnCall = fakeLogger.warn.mock.calls.find(
        (c) => (c[0] as { event?: string }).event === "crawler.stats",
      );
      expect(warnCall).toBeDefined();
      if (!warnCall) throw new Error("no crawler.stats warn call");
      const fields = warnCall[0] as Record<string, unknown>;
      expect(fields.stage).toBe("collect");
      expect(fields.source).toBe("blog");
      expect(fields.requestsFailed).toBe(2);
      // Must not be at info
      const infoCall = fakeLogger.info.mock.calls.find(
        (c) => (c[0] as { event?: string }).event === "crawler.stats",
      );
      expect(infoCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Proxy option: proxyUrl → ProxyConfiguration on the crawler
  // -------------------------------------------------------------------------
  describe("proxy option", () => {
    const jobs: CrawlJob[] = [{ kind: "listing", sourceName: "S", url: "https://ex.com/" }];

    it("passes a ProxyConfiguration when proxyUrl is set", async () => {
      await runWebCrawl(jobs, { proxyUrl: "http://u:p@host:80" });
      expect(getInstance().options.proxyConfiguration).toEqual({
        proxyUrls: ["http://u:p@host:80"],
      });
    });

    it("has no proxyConfiguration when proxyUrl is absent", async () => {
      await runWebCrawl(jobs);
      expect(getInstance().options.proxyConfiguration).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// crawlWithProxyFallback — direct pass first, retry 403s through the proxy
// ---------------------------------------------------------------------------

function convertResult(): {
  markdown: string;
  title: string | null;
  byline: string | null;
  imageUrl: string | null;
  textLength: number;
  publishedAt: Date | null;
  structuredData: string | null;
} {
  return { markdown: "ok", title: "t", byline: null, imageUrl: null, textLength: 2, publishedAt: null, structuredData: null };
}
const ok = (): CrawlResult => ({ ok: true, result: convertResult(), renderedWith: "browser" });
const blocked = (): CrawlResult => ({ ok: false, error: "Request blocked - received 403 status code." });

describe("crawlWithProxyFallback", () => {
  const jobs: CrawlJob[] = [
    { kind: "listing", sourceName: "A", url: "https://a.com/" },
    { kind: "listing", sourceName: "B", url: "https://b.com/" },
  ];

  afterEach(() => {
    delete process.env.WEB_PROXY_URL;
  });

  it("returns the direct result unchanged when WEB_PROXY_URL is unset", async () => {
    delete process.env.WEB_PROXY_URL;
    const direct = new Map<string, CrawlResult>([
      ["https://a.com/", blocked()],
      ["https://b.com/", ok()],
    ]);
    const crawlFn = vi.fn().mockResolvedValue(direct);

    const out = await crawlWithProxyFallback(jobs, {}, crawlFn);

    expect(crawlFn).toHaveBeenCalledTimes(1);
    expect(out).toBe(direct);
  });

  it("retries only the 403-blocked URLs through the proxy and merges recoveries", async () => {
    process.env.WEB_PROXY_URL = "http://u:p@host:80";
    const direct = new Map<string, CrawlResult>([
      ["https://a.com/", blocked()],
      ["https://b.com/", ok()],
    ]);
    const proxied = new Map<string, CrawlResult>([["https://a.com/", ok()]]);
    const crawlFn = vi.fn().mockResolvedValueOnce(direct).mockResolvedValueOnce(proxied);

    const out = await crawlWithProxyFallback(jobs, {}, crawlFn);

    expect(crawlFn).toHaveBeenCalledTimes(2);
    const secondArgs = crawlFn.mock.calls[1] as [CrawlJob[], { proxyUrl?: string }];
    expect(secondArgs[0].map((j) => j.url)).toEqual(["https://a.com/"]);
    expect(secondArgs[1].proxyUrl).toBe("http://u:p@host:80");
    expect(out.get("https://a.com/")?.ok).toBe(true);
  });

  it("does not retry when there are no 403 failures", async () => {
    process.env.WEB_PROXY_URL = "http://u:p@host:80";
    const direct = new Map<string, CrawlResult>([
      ["https://a.com/", { ok: false, error: "HTTP 500 for https://a.com/" }],
      ["https://b.com/", ok()],
    ]);
    const crawlFn = vi.fn().mockResolvedValue(direct);

    const out = await crawlWithProxyFallback(jobs, {}, crawlFn);

    expect(crawlFn).toHaveBeenCalledTimes(1);
    expect(out).toBe(direct);
  });
});
