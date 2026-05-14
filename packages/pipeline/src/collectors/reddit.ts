import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult, RawItemComment, RawItemEngagement, SourceUnitResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import { UrlParseError } from "@pipeline/collectors/hn.js";
import { withAbortSignal } from "@pipeline/lib/abortable-fetch.js";
import { createProxyFetch } from "@pipeline/lib/proxy-fetch.js";

const logger = createLogger("collector:reddit");

const DEFAULT_SUBREDDITS = [
  "MachineLearning", "LocalLLaMA", "artificial", "OpenAI",
  "AI_Agents", "aiagents", "generativeAI",
];
const DEFAULT_SORT = "top";
const DEFAULT_TIMEFRAME = "day";
const DEFAULT_LIMIT = 25;
const DEFAULT_COMMENTS_PER_ITEM = 10;
const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 500;
const COMMENT_RATE_LIMIT_MS = 1000;
const MIN_COMMENTS_FOR_FETCH = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";

function formatCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === "string") return cause;
  if (typeof cause === "number" || typeof cause === "boolean") return String(cause);
  try {
    return JSON.stringify(cause);
  } catch {
    return "[unserializable cause]";
  }
}

export interface RedditCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

interface RedditPostData {
  id: string;
  title: string;
  url: string;
  permalink: string;
  author: string;
  selftext: string;
  is_self: boolean;
  score: number;
  num_comments: number;
  created_utc: number;
  stickied: boolean;
  subreddit: string;
  thumbnail: string;
  preview?: {
    images: {
      source: { url: string; width: number; height: number };
    }[];
  };
}

const REDDIT_THUMBNAIL_SENTINELS = new Set([
  "self", "default", "nsfw", "image", "spoiler", "",
]);

function decodeAmp(url: string): string {
  return url.replaceAll("&amp;", "&");
}

export function extractRedditImageUrl(post: RedditPostData): string | null {
  const previewUrl = post.preview?.images[0]?.source.url;
  if (previewUrl) return decodeAmp(previewUrl);
  const thumb = post.thumbnail;
  if (!thumb) return null;
  if (REDDIT_THUMBNAIL_SENTINELS.has(thumb)) return null;
  if (!thumb.startsWith("http")) return null;
  return decodeAmp(thumb);
}

interface RedditCommentData {
  id: string;
  author: string;
  body: string;
  created_utc: number;
}

interface RedditChild<T> {
  kind: string;
  data: T;
}

interface RedditListing<T> {
  kind: string;
  data: {
    children: RedditChild<T>[];
  };
}

function isRedditListing(value: unknown): value is RedditListing<RedditPostData> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "data" in value &&
    typeof (value as Record<string, unknown>).data === "object" &&
    (value as Record<string, unknown>).data !== null &&
    "children" in ((value as Record<string, unknown>).data as Record<string, unknown>) &&
    Array.isArray(((value as Record<string, unknown>).data as Record<string, unknown[]>).children)
  );
}

function isRedditCommentsResponse(value: unknown): value is [RedditListing<RedditPostData>, RedditListing<RedditCommentData>] {
  return Array.isArray(value) && value.length >= 2;
}

function buildListingUrl(
  subreddit: string,
  sort: string,
  timeframe: string,
  limit: number,
): string {
  return `https://www.reddit.com/r/${subreddit}/${sort}.json?t=${timeframe}&limit=${limit}`;
}

function buildCommentsUrl(
  subreddit: string,
  postId: string,
  limit: number,
): string {
  return `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=${limit}`;
}

async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  retries: number = MAX_RETRIES,
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP error: ${status}`);
        }
        throw new Error(`HTTP error: ${status}`);
      }
      return await response.json();
    } catch (err) {
      if (err instanceof Error) {
        const cause = formatCause(err.cause);
        lastError = cause
          ? new Error(`${err.message} (cause: ${cause})`, { cause: err.cause })
          : err;
      } else {
        lastError = new Error(String(err));
      }
      if (lastError.message.startsWith("Non-retryable")) {
        throw lastError;
      }
      if (attempt < retries - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        await delay(backoffMs);
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

function parseListingItems(data: unknown): RawItemInsert[] {
  if (!isRedditListing(data)) {
    return [];
  }

  const items: RawItemInsert[] = [];

  for (const child of data.data.children) {
    if (child.kind !== "t3") continue;

    const post = child.data;
    if (post.stickied) continue;
    if (!post.title) continue;

    const postUrl = post.is_self
      ? `https://www.reddit.com${post.permalink}`
      : post.url;

    const engagement: RawItemEngagement = { points: post.score, commentCount: post.num_comments };

    items.push({
      sourceType: "reddit" as const,
      externalId: post.id,
      title: post.title,
      url: postUrl,
      sourceUrl: `https://www.reddit.com${post.permalink}`,
      author: post.author,
      content: post.selftext,
      publishedAt: new Date(post.created_utc * 1000),
      collectedAt: new Date(),
      engagement,
      metadata: { comments: [] },
      imageUrl: extractRedditImageUrl(post),
      updatedAt: new Date(),
    });
  }

  return items;
}

async function fetchComments(
  fetchFn: typeof fetch,
  subreddit: string,
  postId: string,
  limit: number,
): Promise<RawItemComment[]> {
  try {
    const url = buildCommentsUrl(subreddit, postId, limit);
    const data = await fetchWithRetry(fetchFn, url);

    if (!isRedditCommentsResponse(data)) {
      return [];
    }

    const commentListing = data[1];
    const comments: RawItemComment[] = [];

    for (const child of commentListing.data.children) {
      if (child.kind !== "t1") continue;

      const comment = child.data;
      comments.push({
        id: comment.id,
        author: comment.author,
        content: comment.body,
        publishedAt: new Date(comment.created_utc * 1000).toISOString(),
      });
    }

    return comments;
  } catch (err) {
    const cause = err instanceof Error ? formatCause(err.cause) : undefined;
    logger.warn(
      {
        subreddit,
        postId,
        error: err instanceof Error ? err.message : String(err),
        cause,
      },
      "comment fetch failed",
    );
    return [];
  }
}

// ── Single-post fetch (add-post flow) ────────────────────────────────────────

const USER_AGENT_SINGLE =
  "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";

export interface FetchRedditPostDeps {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

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
  if (parts.length > 5) return null; // comment permalink

  const subreddit = parts[1];
  const postId = parts[3];
  if (!subreddit || !postId) return null;

  return { subreddit, postId };
}

export async function fetchRedditPost(
  url: string,
  deps: FetchRedditPostDeps = {},
): Promise<RawItemInsert> {
  const parsed = parseRedditPostUrl(url);
  if (!parsed) {
    throw new UrlParseError(`not a recognized Reddit post URL: ${url}`);
  }

  const fetchFn = deps.fetchFn ?? createProxyFetch(process.env.REDDIT_HTTP_PROXY);
  const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  const jsonUrl = `${cleanUrl}.json`;

  logger.info(
    { event: "reddit.single.fetch", ...parsed, url },
    "reddit.single.fetch",
  );

  const response = await fetchFn(jsonUrl, {
    headers: { "User-Agent": USER_AGENT_SINGLE, Accept: "application/json" },
    signal: deps.signal,
  });
  if (!response.ok) {
    throw new Error(
      `Reddit API HTTP ${response.status} for post ${parsed.postId}`,
    );
  }
  const body: unknown = await response.json();
  if (!isRedditCommentsResponse(body)) {
    throw new Error(
      `Reddit API returned unexpected shape for post ${parsed.postId}`,
    );
  }

  const postChild = body[0].data.children.find((c) => c.kind === "t3");
  if (!postChild) {
    throw new Error(`Reddit post ${parsed.postId} not found in response`);
  }
  const post = postChild.data;

  const comments: RawItemComment[] = [];
  for (const child of body[1].data.children) {
    if (child.kind !== "t1") continue;
    const c = child.data;
    comments.push({
      id: c.id,
      author: c.author,
      content: c.body,
      publishedAt: new Date(c.created_utc * 1000).toISOString(),
    });
  }

  const now = new Date();
  const postUrl = post.is_self
    ? `https://www.reddit.com${post.permalink}`
    : post.url;

  return {
    sourceType: "reddit",
    externalId: post.id,
    title: post.title,
    url: postUrl,
    sourceUrl: `https://www.reddit.com${post.permalink}`,
    author: post.author,
    content: post.selftext,
    publishedAt: new Date(post.created_utc * 1000),
    collectedAt: now,
    engagement: { points: post.score, commentCount: post.num_comments },
    metadata: { comments },
    imageUrl: extractRedditImageUrl(post),
    updatedAt: now,
  };
}

// ── Batch collection ──────────────────────────────────────────────────────────

export async function collectReddit(
  deps: RedditCollectorDeps,
  config: RedditCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const baseFetch = deps.fetchFn ?? createProxyFetch(process.env.REDDIT_HTTP_PROXY);
  const fetchFn = deps.signal ? withAbortSignal(baseFetch, deps.signal) : baseFetch;
  const subreddits = config.subreddits ?? DEFAULT_SUBREDDITS;
  const sort = config.sort ?? DEFAULT_SORT;
  const timeframe = config.timeframe ?? DEFAULT_TIMEFRAME;
  const limit = config.limit ?? DEFAULT_LIMIT;
  const commentsPerItem = config.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;

  logger.info(
    {
      event: "collector.reddit.started",
      subreddits,
      sort,
      timeframe,
      limit,
      sinceDays: config.sinceDays,
      commentsPerItem,
    },
    "collection started",
  );

  const seenIds = new Set<string>();
  const allItems: RawItemInsert[] = [];
  const subredditByExternalId = new Map<string, string>();
  const unitResults: SourceUnitResult[] = [];

  for (const subreddit of subreddits) {
    const url = buildListingUrl(subreddit, sort, timeframe, limit);
    const subStart = Date.now();

    try {
      const data = await fetchWithRetry(fetchFn, url);
      const items = parseListingItems(data);

      let added = 0;
      for (const item of items) {
        if (!seenIds.has(item.externalId)) {
          seenIds.add(item.externalId);
          subredditByExternalId.set(item.externalId, subreddit);
          allItems.push(item);
          added++;
        }
      }
      logger.info(
        {
          event: "collector.reddit.subreddit_completed",
          subreddit,
          url,
          sinceDays: config.sinceDays,
          fetched: items.length,
          added,
          durationMs: Date.now() - subStart,
        },
        "subreddit fetched",
      );
      unitResults.push({
        identifier: `r/${subreddit}`,
        displayName: `r/${subreddit}`,
        itemsFetched: added,
        status: "completed",
        errors: [],
        durationMs: Date.now() - subStart,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? formatCause(err.cause) : undefined;
      logger.error(
        {
          event: "collector.reddit.subreddit_failed",
          subreddit,
          url,
          sinceDays: config.sinceDays,
          error: message,
          cause,
          durationMs: Date.now() - subStart,
        },
        "failed to fetch subreddit",
      );
      unitResults.push({
        identifier: `r/${subreddit}`,
        displayName: `r/${subreddit}`,
        itemsFetched: 0,
        status: "failed",
        errors: [cause ? `${message} (cause: ${cause})` : message],
        durationMs: Date.now() - subStart,
      });
    }

    if (subreddit !== subreddits[subreddits.length - 1]) {
      await delay(RATE_LIMIT_MS, deps.signal);
    }
  }

  let totalComments = 0;

  if (commentsPerItem > 0) {
    let commentRequests = 0;
    for (const item of allItems) {
      if (deps.signal?.aborted) break;
      if (!item.engagement || item.engagement.commentCount < MIN_COMMENTS_FOR_FETCH) {
        continue;
      }

      if (commentRequests > 0) {
        await delay(COMMENT_RATE_LIMIT_MS, deps.signal);
      }
      commentRequests++;

      const itemSubreddit = subredditByExternalId.get(item.externalId) ?? "";
      const comments = await fetchComments(
        fetchFn,
        itemSubreddit,
        item.externalId,
        commentsPerItem,
      );
      item.metadata = { comments };
      totalComments += comments.length;

      if (comments.length === 0 && item.engagement.commentCount > 0) {
        logger.warn(
          { externalId: item.externalId, commentCount: item.engagement.commentCount },
          "comment fetch returned empty",
        );
      }
    }
  }

  let filteredItems = allItems;
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
    await deps.rawItemsRepo.upsertItems(filteredItems);
    itemsStored = filteredItems.length;
  }

  const result: CollectorResult = {
    itemsFetched: filteredItems.length,
    commentsFetched: totalComments,
    itemsStored,
    durationMs: Date.now() - startTime,
    unitResults,
  };

  logger.info({ event: "collector.reddit.completed", ...result }, "collection completed");

  return result;
}
