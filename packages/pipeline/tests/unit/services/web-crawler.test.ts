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
): {
  request: { url: string; loadedUrl: string; userData: Record<string, unknown> };
  parseWithCheerio: () => Promise<{ html: () => string }>;
  pushData: ReturnType<typeof vi.fn>;
} {
  return {
    request: { url, loadedUrl: url, userData },
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
const { runWebCrawl } = await import("@pipeline/services/web-crawler.js");

describe("runWebCrawl", () => {
  beforeEach(() => {
    lastMockInstance = null;
    delete process.env.WEB_CRAWLER_CONCURRENCY;
  });

  afterEach(() => {
    vi.clearAllMocks();
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
  // REQ-08: crawler config options
  // -------------------------------------------------------------------------
  it("constructs crawler with required config options", async () => {
    const jobs: CrawlJob[] = [
      { kind: "listing", sourceName: "test-source", url: "https://example.com" },
    ];
    await runWebCrawl(jobs);

    const opts = getInstance().options;
    expect(opts.maxRequestRetries).toBe(3);
    expect(opts.requestHandlerTimeoutSecs).toBe(20);
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
});
