import {
  AdaptivePlaywrightCrawler,
  type AdaptivePlaywrightCrawlerOptions,
  type RequestHandlerResult,
  Configuration,
  ProxyConfiguration,
} from "crawlee";
import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { convert, isHealthyResult, hasListingPostLinks } from "@pipeline/services/web-fetch/convert.js";
import { resolveChromiumExecutablePath } from "@pipeline/services/web-fetch/fetch-browser.js";
import { resolveWebProxyUrl } from "@pipeline/services/web-fetch/proxy.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RunLogger } from "@pipeline/services/run-logger.js";

const logger = createLogger("crawler:web");

export type CrawlJob =
  | { kind: "listing"; sourceName: string; url: string }
  | { kind: "detail"; sourceName: string; postUrl: string; url: string };

export interface CrawlSuccess {
  ok: true;
  result: ConvertResult;
  renderedWith: "static" | "browser";
}

export interface CrawlFailure {
  ok: false;
  error: string;
}

export type CrawlResult = CrawlSuccess | CrawlFailure;

export interface RunWebCrawlOptions {
  signal?: AbortSignal;
  maxConcurrency?: number;
  runLogger?: RunLogger;
}

interface PushedItem {
  url: string;
  result: ConvertResult;
  renderedWith: "static" | "browser";
  mode: FetchMode;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3)}...`;
}

function isCrawlableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function runWebCrawl(
  jobs: CrawlJob[],
  opts: RunWebCrawlOptions = {},
): Promise<Map<string, CrawlResult>> {
  if (jobs.length === 0) return new Map();

  const results = new Map<string, CrawlResult>();

  // Drop URLs Crawlee can't enqueue (relative paths, empty strings, mailto:,
  // etc.). addRequests validates the whole batch atomically via shapeshift, so
  // a single invalid URL would abort the entire crawl and zero out every blog
  // source. Mark dropped URLs as failures so the caller treats them as such.
  const crawlableJobs: CrawlJob[] = [];
  for (const j of jobs) {
    if (isCrawlableUrl(j.url)) {
      crawlableJobs.push(j);
    } else {
      results.set(j.url, { ok: false, error: "invalid-url" });
    }
  }
  if (crawlableJobs.length === 0) return results;

  // Pre-fill with sentinel; overwritten as work completes
  for (const j of crawlableJobs) results.set(j.url, { ok: false, error: "not-completed" });

  const maxConcurrency =
    opts.maxConcurrency ?? Number(process.env.WEB_CRAWLER_CONCURRENCY ?? "4");

  // Crawlee manages its own BrowserPool/PlaywrightPlugin and does NOT read
  // PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH like our direct chromium.launch call
  // in fetch-browser.ts does. Pass executablePath through launchContext so
  // Crawlee uses the apt-installed Chromium instead of trying to download
  // its bundled headless shell (skipped at build via PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).
  const executablePath = resolveChromiumExecutablePath();

  // Route outbound crawl traffic through WEB_HTTP_PROXY when set; a single
  // ProxyConfiguration covers both the static and the adaptive-browser
  // sub-paths. Unset ⇒ undefined ⇒ direct egress (unchanged behaviour). The
  // proxy URL is a secret and must never be logged.
  const proxyUrl = resolveWebProxyUrl();

  const crawlerOptions: AdaptivePlaywrightCrawlerOptions = {
    maxConcurrency,
    proxyConfiguration: proxyUrl
      ? new ProxyConfiguration({ proxyUrls: [proxyUrl] })
      : undefined,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 30,
    sameDomainDelaySecs: 1,
    respectRobotsTxtFile: true,
    renderingTypeDetectionRatio: 0.1,
    launchContext: executablePath
      ? { launchOptions: { executablePath } }
      : undefined,

    // When the browser path is used (Adaptive promotes a URL after the static
    // path fails resultChecker), navigate only to domcontentloaded — `load`
    // and `networkidle` both hang on chatty pages (Substack with analytics,
    // RUM, ads beacons keeps the network busy past 25s).
    preNavigationHooks: [
      (ctx, gotoOptions) => {
        if (ctx.page && gotoOptions) {
          gotoOptions.waitUntil = "domcontentloaded";
          gotoOptions.timeout = 25_000;
        }
      },
    ],
    // After domcontentloaded fires, chase a short networkidle window. Quiet
    // pages settle within the budget so we don't read mid-hydration; chatty
    // pages hit the chase timeout and proceed anyway. Generic across sources
    // — no per-site selector knowledge required.
    postNavigationHooks: [
      async (ctx) => {
        if (ctx.page) {
          await ctx.page
            .waitForLoadState("networkidle", { timeout: 4_000 })
            .catch(() => {
              // Networkidle never fires on chatty pages — proceed anyway.
            });
        }
      },
    ],

    requestHandler: async (context) => {
      const userData = context.request.userData as {
        kind: "listing" | "detail";
        sourceName: string;
        postUrl?: string;
        mode: FetchMode;
      };

      // Reject non-2xx responses before we ever convert HTML — error pages
      // (404/410/5xx) carry no useful content and pollute downstream prompts.
      const status = context.response.statusCode;
      if (status < 200 || status >= 300) {
        throw new Error(`HTTP ${status} for ${context.request.url}`);
      }

      // parseWithCheerio() works for both static and browser paths:
      // - static path: parses the HTTP response body
      // - browser path: calls page.content() then parses
      // We call $.html() to get the full document HTML for our convert function.
      const $ = await context.parseWithCheerio();
      const html = $.html();

      const baseUrl = context.request.loadedUrl;
      const convertResult = convert({ html, baseUrl, mode: userData.mode });

      // Determine render path: in browser mode, page access does not throw.
      // In HTTP mode, accessing page throws (triggering browser retry).
      // We use the presence of a page with a URL as the discriminator —
      // but since accessing `page` in HTTP mode triggers an error/retry,
      // we track renderedWith based on whether we already have the result
      // after an HTTP attempt. The safest approach: always treat the result
      // as "static" unless we know browser was used. Crawlee's internal
      // AdaptivePlaywrightCrawler calls the same handler for both paths —
      // from the handler's perspective there is no safe synchronous way to
      // distinguish without touching `page`. We use "static" as the default
      // and let Crawlee's retry mechanism handle browser fallback transparently.
      const renderedWith: "static" | "browser" = "static";

      const item: PushedItem = {
        url: context.request.url,
        result: convertResult,
        renderedWith,
        mode: userData.mode,
      };
      await context.pushData(item);
      results.set(context.request.url, { ok: true, result: convertResult, renderedWith });
    },

    failedRequestHandler: (context, error: Error) => {
      const message = truncate(
        error instanceof Error ? error.message : String(error),
        200,
      );
      results.set(context.request.url, { ok: false, error: message });
    },

    resultChecker: (handlerResult: RequestHandlerResult): boolean => {
      const items = handlerResult.datasetItems;
      if (items.length === 0) return true;
      // items[n] is typed non-nullable (noUncheckedIndexedAccess is off)
      const pushed = items[items.length - 1].item as PushedItem | undefined;
      if (!pushed?.result) return true;
      if (!isHealthyResult(pushed.result)) return false;
      // Listing pages must actually contain post links. JS-rendered shells
      // (e.g. Substack landing) clear the text-length bar but ship zero post
      // anchors in static HTML — force browser fallback to paint the real list.
      if (pushed.mode === "listing" && !hasListingPostLinks(pushed.result.markdown)) {
        return false;
      }
      return true;
    },
  };

  // Fresh in-memory storage per call so URLs are not deduped across runs
  // within the long-running worker process (Crawlee's default RequestQueue
  // persists to disk and treats already-handled URLs as skippable).
  const config = new Configuration({ persistStorage: false });
  const crawler = new AdaptivePlaywrightCrawler(crawlerOptions, config);

  const onAbort = (): void => {
    logger.info({ event: "crawler.abort" }, "abort signal received — tearing down crawler");
    void crawler.teardown();
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await crawler.run(
      crawlableJobs.map((j) => ({
        url: j.url,
        userData: {
          kind: j.kind,
          sourceName: j.sourceName,
          postUrl: j.kind === "detail" ? j.postUrl : undefined,
          mode: (j.kind === "listing" ? "listing" : "article") as FetchMode,
        },
      })),
    );
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  // Replace any remaining sentinels with "cancelled" if signal fired
  if (opts.signal?.aborted) {
    for (const [url, r] of results) {
      if (!r.ok && r.error === "not-completed") {
        results.set(url, { ok: false, error: "cancelled" });
      }
    }
  }

  const statsState = crawler.stats.state;
  const statsFields = {
    event: "crawler.stats" as const,
    jobs: jobs.length,
    crawlableJobs: crawlableJobs.length,
    droppedInvalidUrls: jobs.length - crawlableJobs.length,
    requestsFinished: statsState.requestsFinished,
    requestsFailed: statsState.requestsFailed,
    requestsRetries: statsState.requestsRetries,
    httpOnlyRequestHandlerRuns: statsState.httpOnlyRequestHandlerRuns,
    browserRequestHandlerRuns: statsState.browserRequestHandlerRuns,
    renderingTypeMispredictions: statsState.renderingTypeMispredictions,
  };
  logger.info(statsFields, "crawler completed");
  const runLogLevel: "info" | "warn" =
    statsState.requestsFailed > 0 ? "warn" : "info";
  void opts.runLogger?.[runLogLevel](
    { stage: "collect", source: "blog", step: "crawl", ...statsFields },
    "crawler completed",
  );

  return results;
}
