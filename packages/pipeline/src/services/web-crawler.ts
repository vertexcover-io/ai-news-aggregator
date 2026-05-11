import {
  AdaptivePlaywrightCrawler,
  type AdaptivePlaywrightCrawlerOptions,
  type RequestHandlerResult,
  Configuration,
} from "crawlee";
import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { convert, isHealthyResult } from "@pipeline/services/web-fetch/convert.js";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("crawler:web");

const MAX_ERROR_LENGTH = 200;

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
}

interface PushedItem {
  url: string;
  result: ConvertResult;
  renderedWith: "static" | "browser";
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3)}...`;
}

export async function runWebCrawl(
  jobs: CrawlJob[],
  opts: RunWebCrawlOptions = {},
): Promise<Map<string, CrawlResult>> {
  if (jobs.length === 0) return new Map();

  const results = new Map<string, CrawlResult>();
  // Pre-fill with sentinel; overwritten as work completes
  for (const j of jobs) results.set(j.url, { ok: false, error: "not-completed" });

  const maxConcurrency =
    opts.maxConcurrency ?? Number(process.env.WEB_CRAWLER_CONCURRENCY ?? "4");

  const crawlerOptions: AdaptivePlaywrightCrawlerOptions = {
    maxConcurrency,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 20,
    sameDomainDelaySecs: 1,
    respectRobotsTxtFile: true,
    renderingTypeDetectionRatio: 0.1,

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
      };
      await context.pushData(item);
      results.set(context.request.url, { ok: true, result: convertResult, renderedWith });
    },

    failedRequestHandler: (context, error: Error) => {
      const message = truncate(
        error instanceof Error ? error.message : String(error),
        MAX_ERROR_LENGTH,
      );
      results.set(context.request.url, { ok: false, error: message });
    },

    resultChecker: (handlerResult: RequestHandlerResult): boolean => {
      const items = handlerResult.datasetItems;
      if (items.length === 0) return true;
      // items[n] is typed non-nullable (noUncheckedIndexedAccess is off)
      const pushed = items[items.length - 1].item as PushedItem | undefined;
      if (!pushed?.result) return true;
      return isHealthyResult(pushed.result);
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
      jobs.map((j) => ({
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
  logger.info(
    {
      event: "crawler.stats",
      jobs: jobs.length,
      requestsFinished: statsState.requestsFinished,
      requestsFailed: statsState.requestsFailed,
      requestsRetries: statsState.requestsRetries,
      httpOnlyRequestHandlerRuns: statsState.httpOnlyRequestHandlerRuns,
      browserRequestHandlerRuns: statsState.browserRequestHandlerRuns,
      renderingTypeMispredictions: statsState.renderingTypeMispredictions,
    },
    "crawler completed",
  );

  return results;
}
