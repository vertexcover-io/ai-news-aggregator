import type {
  RunSubmitHnConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
} from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import {
  classifyCollectorHealthError,
  classifyCollectorHealthToken,
} from "@pipeline/services/collector-health/classify.js";
import type { CrawlJob, RunWebCrawlOptions, CrawlResult } from "@pipeline/services/web-crawler.js";
import type { TwitterCollectorCookie } from "@pipeline/services/credential-resolver.js";
import type { WebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";
import type { RettiwtFacade } from "@pipeline/collectors/twitter/clients/rettiwt.js";

export type CheckableCollector = "hn" | "reddit" | "twitter" | "blog" | "web_search";

export interface CollectorHealthOutcome {
  status: "healthy" | "failed";
  durationMs: number;
  reason: string | null;
  detail: string | null;
}

// The subset of settings that each strategy needs — pipeline-local, not persisted in DB
export interface HealthCheckSettings {
  hn?: Pick<RunSubmitHnConfig, "keywords" | "feeds" | "pointsThreshold" | "count">;
  reddit?: Pick<RedditCollectConfig, "subreddits" | "sort" | "timeframe" | "limit">;
  twitter?: Pick<RunSubmitTwitterConfig, "listIds" | "users" | "maxTweetsPerSource" | "sinceHours">;
  web?: Pick<RunSubmitWebConfig, "sources" | "maxItems">;
  webSearch?: Pick<RunSubmitWebSearchConfig, "queries" | "provider">;
}

export interface HealthCheckLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

export interface HealthCheckCredentialResolver {
  resolveTwitterCollectorCookie(): Promise<TwitterCollectorCookie | null>;
  tavilyApiKey: string | undefined;
}

// Injectable deps per spec S-pipeline-03 / D-051
export interface HealthCheckDeps {
  fetchFn?: typeof fetch;
  rettiwtClientFactory?: (apiKey: string) => RettiwtFacade;
  runWebCrawl?: (jobs: CrawlJob[], opts?: RunWebCrawlOptions) => Promise<Map<string, CrawlResult>>;
  tavilyFactory?: (apiKey: string) => WebSearchProvider;
  credentialResolver: HealthCheckCredentialResolver;
  logger: HealthCheckLogger;
  now?: () => number;
}

export interface RunHealthCheckOptions {
  timeoutMs?: number;
}

// Per-collector timeouts (REQ-020)
const COLLECTOR_TIMEOUT_MS: Record<CheckableCollector, number> = {
  blog: 35_000,
  twitter: 15_000,
  web_search: 15_000,
  hn: 10_000,
  reddit: 10_000,
};

const NOT_CONFIGURED_REASON = "not configured — add sources at /admin/settings";
const ALGOLIA_SEARCH_BASE = "https://hn.algolia.com/api/v1/search_by_date";
const REDDIT_USER_AGENT = "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const t = setTimeout(() => {
      const err = new Error(`health check timed out after ${ms}ms`);
      err.name = "AbortError";
      reject(err);
    }, ms);
    // Allow node to exit even if timeout is pending
    if (typeof t.unref === "function") t.unref();
  });
  return Promise.race([promise, timeoutPromise]);
}

function measureMs(start: number, now: () => number): number {
  return now() - start;
}

// ─── HN strategy ─────────────────────────────────────────────────────────────

async function runHnStrategy(
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
): Promise<CollectorHealthOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const start = now();

  const keyword = settings.hn?.keywords?.[0] ?? "AI";
  const params = new URLSearchParams({ query: keyword, tags: "story", hitsPerPage: "1" });
  const url = `${ALGOLIA_SEARCH_BASE}?${params.toString()}`;

  const response = await fetchFn(url);
  if (!response.ok) {
    const err = Object.assign(new Error(`HTTP error: ${response.status}`), { status: response.status });
    throw err;
  }
  const body: unknown = await response.json();

  let hitsCount = 0;
  if (typeof body === "object" && body !== null && "hits" in body && Array.isArray((body as { hits: unknown }).hits)) {
    hitsCount = (body as { hits: unknown[] }).hits.length;
  }

  return {
    status: "healthy",
    durationMs: measureMs(start, now),
    reason: null,
    detail: `algolia hits: ${hitsCount}`,
  };
}

// ─── Reddit strategy ──────────────────────────────────────────────────────────

function buildRedditRssUrl(subreddit: string, sort: string, timeframe: string, limit: number): string {
  const params = new URLSearchParams();
  if (sort === "top") params.set("t", timeframe);
  params.set("limit", String(limit));
  return `https://www.reddit.com/r/${subreddit}/${sort}.rss?${params.toString()}`;
}

async function runRedditStrategy(
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
): Promise<CollectorHealthOutcome> {
  const subreddits = settings.reddit?.subreddits ?? [];
  if (subreddits.length === 0) {
    return { status: "failed", durationMs: 0, reason: NOT_CONFIGURED_REASON, detail: null };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const start = now();

  const subreddit = subreddits[0];
  const sort = settings.reddit?.sort ?? "top";
  const timeframe = settings.reddit?.timeframe ?? "day";
  const limit = settings.reddit?.limit ?? 10;

  const url = buildRedditRssUrl(subreddit, sort, timeframe, limit);

  const response = await fetchFn(url, {
    headers: {
      "User-Agent": REDDIT_USER_AGENT,
      Accept: "application/atom+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    const err = Object.assign(new Error(`HTTP error: ${response.status}`), { status: response.status });
    throw err;
  }

  const xml = await response.text();

  // Parse entry count — we just need any parseable XML with entries
  const entryMatches = xml.match(/<entry>/gi);
  const entryCount = entryMatches ? entryMatches.length : 0;

  const canonicalSub = subreddit.toLowerCase();
  return {
    status: "healthy",
    durationMs: measureMs(start, now),
    reason: null,
    detail: `r/${canonicalSub}: ${entryCount} entries`,
  };
}

// ─── Twitter strategy ─────────────────────────────────────────────────────────

async function runTwitterStrategy(
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
): Promise<CollectorHealthOutcome> {
  const listIds = settings.twitter?.listIds ?? [];
  const users = settings.twitter?.users ?? [];
  if (listIds.length === 0 && users.length === 0) {
    return { status: "failed", durationMs: 0, reason: NOT_CONFIGURED_REASON, detail: null };
  }

  const now = deps.now ?? Date.now;
  const start = now();

  // Resolve cookie — missing = failed (REQ-022)
  const cookie = await deps.credentialResolver.resolveTwitterCollectorCookie();
  if (!cookie) {
    return {
      status: "failed",
      durationMs: measureMs(start, now),
      reason: "Twitter cookies not configured — set them at /admin/settings",
      detail: null,
    };
  }

  if (!deps.rettiwtClientFactory) {
    return {
      status: "failed",
      durationMs: measureMs(start, now),
      reason: "rettiwtClientFactory not provided",
      detail: null,
    };
  }

  const rettiwt = deps.rettiwtClientFactory(cookie.apiKey);

  // Use first list or first user, count 1 — minimal probe
  if (listIds.length > 0) {
    await rettiwt.list.tweets(listIds[0], 1);
  } else {
    const firstUser = users[0];
    await rettiwt.user.timeline(firstUser.userId, 1);
  }

  return {
    status: "healthy",
    durationMs: measureMs(start, now),
    reason: null,
    detail: `authenticated read: ok`,
  };
}

// ─── Blog strategy ────────────────────────────────────────────────────────────

async function runBlogStrategy(
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
): Promise<CollectorHealthOutcome> {
  const sources = settings.web?.sources ?? [];
  if (sources.length === 0) {
    return { status: "failed", durationMs: 0, reason: NOT_CONFIGURED_REASON, detail: null };
  }

  if (!deps.runWebCrawl) {
    return {
      status: "failed",
      durationMs: 0,
      reason: "runWebCrawl not provided",
      detail: null,
    };
  }

  const now = deps.now ?? Date.now;
  const start = now();

  const firstSource = sources[0];
  const url = firstSource.listingUrl;

  const crawlJob: CrawlJob = { kind: "listing", sourceName: firstSource.name, url };
  const results = await deps.runWebCrawl([crawlJob]);

  const crawlResult = results.get(url);
  if (!crawlResult) {
    throw new Error(`crawler returned no result for ${url}`);
  }

  if (!crawlResult.ok) {
    const err = new Error(crawlResult.error);
    throw err;
  }

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // keep raw url as fallback
  }

  return {
    status: "healthy",
    durationMs: measureMs(start, now),
    reason: null,
    detail: `crawled ${hostname}`,
  };
}

// ─── web_search strategy ──────────────────────────────────────────────────────

async function runWebSearchStrategy(
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
): Promise<CollectorHealthOutcome> {
  const queries = settings.webSearch?.queries ?? [];
  if (queries.length === 0) {
    return { status: "failed", durationMs: 0, reason: NOT_CONFIGURED_REASON, detail: null };
  }

  const tavilyApiKey = deps.credentialResolver.tavilyApiKey;
  if (!tavilyApiKey) {
    return {
      status: "failed",
      durationMs: 0,
      reason: "TAVILY_API_KEY is not configured — set it in your environment",
      detail: null,
    };
  }

  if (!deps.tavilyFactory) {
    return {
      status: "failed",
      durationMs: 0,
      reason: "tavilyFactory not provided",
      detail: null,
    };
  }

  const now = deps.now ?? Date.now;
  const start = now();

  const provider = deps.tavilyFactory(tavilyApiKey);
  const results = await provider.search({ query: "AI", sinceDays: 7, maxItems: 1 });

  return {
    status: "healthy",
    durationMs: measureMs(start, now),
    reason: null,
    detail: `tavily results: ${results.length}`,
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function runStrategy(
  collector: CheckableCollector,
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
): Promise<CollectorHealthOutcome> {
  switch (collector) {
    case "hn":
      return runHnStrategy(settings, deps);
    case "reddit":
      return runRedditStrategy(settings, deps);
    case "twitter":
      return runTwitterStrategy(settings, deps);
    case "blog":
      return runBlogStrategy(settings, deps);
    case "web_search":
      return runWebSearchStrategy(settings, deps);
    default: {
      const _exhaustive: never = collector;
      throw new Error(`unknown collector: ${String(_exhaustive)}`);
    }
  }
}

export async function runCollectorHealthCheck(
  collector: CheckableCollector,
  settings: HealthCheckSettings,
  deps: HealthCheckDeps,
  opts: RunHealthCheckOptions = {},
): Promise<CollectorHealthOutcome> {
  const now = deps.now ?? Date.now;
  const start = now();
  const timeoutMs = opts.timeoutMs ?? COLLECTOR_TIMEOUT_MS[collector];

  try {
    const outcome = await withTimeout(runStrategy(collector, settings, deps), timeoutMs);
    return outcome;
  } catch (err) {
    const durationMs = measureMs(start, now);
    const msg = err instanceof Error ? err.message : String(err);

    // Timeout — err.name is AbortError from our timer
    if (err instanceof Error && err.name === "AbortError" && msg.includes("timed out")) {
      deps.logger.warn(
        { event: "collector.health.timeout", collector, durationMs },
        "health check timed out",
      );
      return {
        status: "failed",
        durationMs,
        reason: `health check timeout after ${timeoutMs}ms`,
        detail: null,
      };
    }

    // Auth error on Twitter → rotate-cookies message (EDGE-011)
    if (collector === "twitter") {
      const token = classifyCollectorHealthToken(collector, err);
      if (token === "auth") {
        deps.logger.error(
          { event: "collector.health.failed", collector, classified: token, error: msg },
          "health check failed",
        );
        return {
          status: "failed",
          durationMs,
          reason: "auth failed — rotate Twitter cookies at /admin/settings",
          detail: null,
        };
      }
    }

    const token = classifyCollectorHealthToken(collector, err);
    const reason = classifyCollectorHealthError(collector, err);
    deps.logger.error(
      { event: "collector.health.failed", collector, classified: token, error: msg },
      "health check failed",
    );
    return {
      status: "failed",
      durationMs,
      reason,
      detail: null,
    };
  }
}
