import type { HealthCheckResult } from "@newsletter/shared/types";
import type { BlogSource } from "@pipeline/types.js";
import type { DiscoveredPost } from "@pipeline/collectors/web.js";
import type { CrawlJob, CrawlResult } from "@pipeline/services/web-crawler.js";
import type { LanguageModel } from "ai";

export interface BlogHealthDeps {
  /** Returns the configured blog sources. */
  getSources: () => BlogSource[];
  /** Returns the DeepSeek model or undefined if DEEPSEEK_API_KEY not set. */
  getModel: () => LanguageModel | undefined;
  /** Crawls one or more URLs. Injected so we can mock it. */
  runCrawl?: (jobs: CrawlJob[], opts?: { signal?: AbortSignal }) => Promise<Map<string, CrawlResult>>;
  /** Discovers post URLs from listing markdown via LLM. */
  discoverPosts?: (listingUrl: string, markdown: string, structuredData: string | null, model: LanguageModel) => Promise<DiscoveredPost[]>;
}

export function classifyBlogError(err: unknown): string {
  if (typeof err === "string") return err;
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;
  // Check "no posts" before LLM to avoid the word matching the LLM pattern
  if (/no posts/i.test(msg)) {
    return msg;
  }
  if (/timeout|aborted|ETIMEDOUT/i.test(msg)) {
    return "Blog crawl or LLM request timed out";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(msg)) {
    return "Blog source unreachable — network error";
  }
  if (/(?:^|\s)(?:5\d{2})(?:\s|$|:)/.test(msg)) {
    return "Blog LLM or crawl returned a server error (5xx)";
  }
  if (/LLM|API.*key|unauthorized|4(?:0[13]|01)|402/i.test(msg)) {
    return "Blog LLM API error — check DEEPSEEK_API_KEY is valid and has credits";
  }
  return msg;
}

async function defaultRunCrawl(
  jobs: CrawlJob[],
  _opts?: { signal?: AbortSignal },
): Promise<Map<string, CrawlResult>> {
  // Dynamic import to keep health check module lightweight
  const { runWebCrawl } = await import("@pipeline/services/web-crawler.js");
  return runWebCrawl(jobs, { maxConcurrency: 1 });
}

async function defaultDiscoverPosts(
  listingUrl: string,
  markdown: string,
  structuredData: string | null,
  model: LanguageModel,
): Promise<DiscoveredPost[]> {
  const { discoverPostUrls } = await import("@pipeline/collectors/web.js");
  return discoverPostUrls(listingUrl, markdown, structuredData, model);
}

export async function checkBlogHealth(deps: BlogHealthDeps): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const sources = deps.getSources();
    if (sources.length === 0) {
      return {
        collector: "blog",
        status: "skipped",
        durationMs: Date.now() - start,
        reason: "no sources configured — add blog sources in settings",
      };
    }

    const model = deps.getModel();
    if (model === undefined) {
      return {
        collector: "blog",
        status: "skipped",
        durationMs: Date.now() - start,
        reason: "API key not configured — set DEEPSEEK_API_KEY in environment",
      };
    }

    // Only check the first configured source
    const firstSource = sources[0];
    const runCrawl = deps.runCrawl ?? defaultRunCrawl;
    const discoverPosts = deps.discoverPosts ?? defaultDiscoverPosts;

    const listingJob: CrawlJob = {
      kind: "listing",
      sourceName: firstSource.name,
      url: firstSource.listingUrl,
    };
    const crawlResults = await runCrawl([listingJob]);

    const listingResult = crawlResults.get(firstSource.listingUrl);
    if (!listingResult?.ok) {
      throw new Error(listingResult?.error ?? "crawl returned no result");
    }

    const discovered = await discoverPosts(
      firstSource.listingUrl,
      listingResult.result.markdown,
      listingResult.result.structuredData ?? null,
      model,
    );

    if (discovered.length === 0) {
      throw new Error(
        `LLM discovery returned no posts for "${firstSource.name}" — listing page structure may have changed`,
      );
    }

    return {
      collector: "blog",
      status: "healthy",
      durationMs: Date.now() - start,
      itemsFound: discovered.length,
    };
  } catch (err) {
    return {
      collector: "blog",
      status: "failed",
      durationMs: Date.now() - start,
      error: classifyBlogError(err),
    };
  }
}
