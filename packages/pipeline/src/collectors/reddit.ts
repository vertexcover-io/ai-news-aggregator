/**
 * Reddit collector — Apify-based (REQ-001, REQ-023).
 *
 * All atom/xml parsing code has been removed. Posts are fetched via the Apify
 * `trudax/reddit-scraper-lite` actor through injected runner dependencies.
 *
 * The collector is db-free: token resolution is an injected dep, wired with
 * real defaults in the worker/dispatch call sites.
 */
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult, SourceUnitResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { UrlParseError } from "@pipeline/collectors/hn.js";
import { enrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";
import {
  buildListingInput,
  mapApifyPostToRawItem,
  runRedditListing as defaultRunListing,
  runRedditPost as defaultRunPost,
  type ApifyRedditPost,
  type ApifyActorInput,
} from "@pipeline/lib/apify-reddit.js";

const logger = createLogger("collector:reddit");

const DEFAULT_SUBREDDITS = [
  "MachineLearning", "LocalLLaMA", "artificial", "OpenAI",
  "AI_Agents", "aiagents", "generativeAI",
];
const DEFAULT_SORT = "top";
const DEFAULT_TIMEFRAME = "day";
const DEFAULT_LIMIT = 25;

// ── Type aliases for injected runners ─────────────────────────────────────────

type RunListingFn = (
  token: string,
  input: ApifyActorInput,
  opts?: { signal?: AbortSignal },
) => Promise<ApifyRedditPost[]>;

type RunPostFn = (
  token: string,
  permalink: string,
  opts?: { signal?: AbortSignal },
) => Promise<ApifyRedditPost[]>;

// ── Single-post deps ──────────────────────────────────────────────────────────

export interface FetchRedditPostDeps {
  resolveToken?: () => Promise<{ apiToken: string; source: "db" | "env" } | null>;
  runPost?: RunPostFn;
  signal?: AbortSignal;
}

// ── Batch-collection deps ─────────────────────────────────────────────────────

export interface RedditCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  resolveToken?: () => Promise<{ apiToken: string; source: "db" | "env" } | null>;
  runListing?: RunListingFn;
  signal?: AbortSignal;
  enrichment?: EnrichmentContext;
}

// ── Pure URL parser (retained — source-detector, no network) ─────────────────

export interface ParsedRedditPostUrl {
  subreddit: string;
  postId: string;
}

export function parseRedditPostUrl(url: string): ParsedRedditPostUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  if (
    u.hostname !== "www.reddit.com" &&
    u.hostname !== "reddit.com" &&
    u.hostname !== "old.reddit.com"
  ) {
    return null;
  }

  const parts = u.pathname.split("/").filter((p) => p.length > 0);
  // Expected: ["r", "<sub>", "comments", "<postId>", "<slug>"]
  // Comment permalink adds one more segment: ["r","<sub>","comments","<postId>","<slug>","<commentId>"]
  if (parts.length < 4) return null;
  if (parts[0] !== "r" || parts[2] !== "comments") return null;
  if (parts.length > 5) return null;

  const subreddit = parts[1];
  const postId = parts[3];
  if (!subreddit || !postId) return null;

  return { subreddit, postId };
}

// ── Single-post fetch (add-post flow) ─────────────────────────────────────────

export async function fetchRedditPost(
  url: string,
  deps: FetchRedditPostDeps = {},
): Promise<RawItemInsert> {
  const parsed = parseRedditPostUrl(url);
  if (!parsed) {
    throw new UrlParseError(`not a recognized Reddit post URL: ${url}`);
  }

  // REQ-021 / EDGE-010: no token → throw typed error
  const tok = deps.resolveToken ? await deps.resolveToken() : null;
  if (!tok) {
    throw new Error("Apify integration not configured");
  }

  const runPost = deps.runPost ?? defaultRunPost;
  const posts = await runPost(tok.apiToken, url, { signal: deps.signal });

  const now = new Date();
  const mapped = posts
    .map((p) => mapApifyPostToRawItem(p, now))
    .filter((p): p is RawItemInsert => p !== null);

  if (mapped.length === 0) {
    throw new Error("post not found");
  }

  // Find the post whose externalId matches the parsed postId
  return mapped.find((m) => m.externalId === parsed.postId) ?? mapped[0];
}

// ── Batch collection ──────────────────────────────────────────────────────────

export async function collectReddit(
  deps: RedditCollectorDeps,
  config: RedditCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const subreddits = config.subreddits ?? DEFAULT_SUBREDDITS;
  const sort = config.sort ?? DEFAULT_SORT;
  const timeframe = config.timeframe ?? DEFAULT_TIMEFRAME;
  const limit = config.limit ?? DEFAULT_LIMIT;

  logger.info(
    {
      event: "collector.reddit.started",
      subreddits,
      sort,
      timeframe,
      limit,
      sinceDays: config.sinceDays,
      commentsPerItem: 0,
      requestedCommentsPerItem: config.commentsPerItem ?? 0,
    },
    "collection started",
  );

  // REQ-020 / EDGE-001: no token → warn + return empty result
  const tok = deps.resolveToken ? await deps.resolveToken() : null;
  if (!tok) {
    logger.warn(
      { event: "collector.reddit.disabled" },
      "collector.reddit.disabled: no Apify token configured; skipping Reddit collection",
    );
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: Date.now() - startTime,
      unitResults: [],
    };
  }

  const runListing = deps.runListing ?? defaultRunListing;
  const input = buildListingInput(subreddits, sort, timeframe, limit);

  // REQ-022 / EDGE-002: propagate actor errors to caller
  const rawPosts = await runListing(tok.apiToken, input, { signal: deps.signal });

  const now = new Date();

  // Map + skip malformed (EDGE-004)
  const allMapped: RawItemInsert[] = rawPosts
    .map((p) => mapApifyPostToRawItem(p, now))
    .filter((p): p is RawItemInsert => p !== null);

  // De-duplicate by externalId (REQ-007, EDGE-006)
  const seenIds = new Set<string>();
  const deduped: RawItemInsert[] = [];
  for (const item of allMapped) {
    if (!seenIds.has(item.externalId)) {
      seenIds.add(item.externalId);
      deduped.push(item);
    }
  }

  // Group by parsedCommunityName / sourceUnit identifier for unitResults
  // (REQ-006; empty subs still get a unit, EDGE-003)
  const bySubreddit = new Map<string, RawItemInsert[]>();
  for (const sub of subreddits) {
    bySubreddit.set(sub, []);
  }
  for (const item of deduped) {
    const subName = item.metadata?.sourceUnit?.identifier.replace(/^r\//, "") ?? "";
    // Find the canonical subreddit key (case-insensitive match to config)
    const canonKey = subreddits.find(
      (s) => s.toLowerCase() === subName.toLowerCase(),
    ) ?? subName;
    const existing = bySubreddit.get(canonKey);
    if (existing !== undefined) {
      existing.push(item);
    } else {
      bySubreddit.set(canonKey, [item]);
    }
  }

  // Cap per subreddit to limit (REQ-025, EDGE-009)
  const cappedItems: RawItemInsert[] = [];
  const unitResults: SourceUnitResult[] = [];
  const subStart = Date.now();

  for (const sub of subreddits) {
    const items = bySubreddit.get(sub) ?? [];
    const capped = items.slice(0, limit);
    for (const item of capped) {
      cappedItems.push(item);
    }
    unitResults.push({
      identifier: `r/${sub}`,
      displayName: `r/${sub}`,
      itemsFetched: capped.length,
      status: "completed",
      errors: [],
      durationMs: Date.now() - subStart,
    });
  }

  // Add any items from subreddits not in the config list
  for (const [sub, items] of bySubreddit.entries()) {
    if (!subreddits.includes(sub)) {
      cappedItems.push(...items.slice(0, limit));
    }
  }

  // sinceDays filter (REQ-008, EDGE-005)
  let filteredItems = cappedItems;
  if (config.sinceDays !== undefined && config.sinceDays > 0) {
    const cutoff = Date.now() - config.sinceDays * 86_400_000;
    const before = filteredItems.length;
    filteredItems = filteredItems.filter((item) => {
      if (!item.publishedAt) return true;
      const t = item.publishedAt.getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
    const dropped = before - filteredItems.length;
    if (dropped === 0 && before > 0) {
      logger.warn(
        { sinceDays: config.sinceDays, fetched: before },
        "sinceDays filter dropped 0 items — feed may be truncated",
      );
    }
  }

  let itemsStored = 0;

  if (filteredItems.length > 0) {
    if (deps.enrichment) {
      await enrichRawItems(filteredItems, deps.enrichment);
    }
    await deps.rawItemsRepo.upsertItems(filteredItems);
    itemsStored = filteredItems.length;
  }

  const result: CollectorResult = {
    itemsFetched: filteredItems.length,
    commentsFetched: 0,
    itemsStored,
    durationMs: Date.now() - startTime,
    unitResults,
  };

  logger.info({ event: "collector.reddit.completed", ...result }, "collection completed");

  return result;
}
