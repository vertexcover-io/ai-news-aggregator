import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

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
const COMMENT_RATE_LIMIT_MS = 2000;
const MIN_COMMENTS_FOR_FETCH = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";

export interface RedditCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
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

interface ParsedComment {
  id: string;
  author: string;
  content: string;
  publishedAt: string;
}

interface ParsedItem {
  title: string;
  url: string;
  externalId: string;
  author: string;
  content: string;
  publishedAt: Date;
  sourceUrl: string;
  subreddit: string;
  engagement: { points: number; commentCount: number };
  comments: ParsedComment[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      lastError = err instanceof Error ? err : new Error(String(err));
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

function parseListingItems(data: unknown): ParsedItem[] {
  if (!isRedditListing(data)) {
    return [];
  }

  const items: ParsedItem[] = [];

  for (const child of data.data.children) {
    if (child.kind !== "t3") continue;

    const post = child.data;
    if (post.stickied) continue;
    if (!post.title) continue;

    const postUrl = post.is_self
      ? `https://www.reddit.com${post.permalink}`
      : post.url;

    items.push({
      title: post.title,
      url: postUrl,
      externalId: post.id,
      author: post.author,
      content: post.selftext,
      publishedAt: new Date(post.created_utc * 1000),
      sourceUrl: `https://www.reddit.com${post.permalink}`,
      subreddit: post.subreddit,
      engagement: { points: post.score, commentCount: post.num_comments },
      comments: [],
    });
  }

  return items;
}

async function fetchComments(
  fetchFn: typeof fetch,
  subreddit: string,
  postId: string,
  limit: number,
): Promise<ParsedComment[]> {
  try {
    const url = buildCommentsUrl(subreddit, postId, limit);
    const data = await fetchWithRetry(fetchFn, url);

    if (!isRedditCommentsResponse(data)) {
      return [];
    }

    const commentListing = data[1];
    const comments: ParsedComment[] = [];

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
    logger.warn(
      { subreddit, postId, error: err instanceof Error ? err.message : String(err) },
      "comment fetch failed",
    );
    return [];
  }
}

export async function collectReddit(
  deps: RedditCollectorDeps,
  config: RedditCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const subreddits = config.subreddits ?? DEFAULT_SUBREDDITS;
  const sort = config.sort ?? DEFAULT_SORT;
  const timeframe = config.timeframe ?? DEFAULT_TIMEFRAME;
  const limit = config.limit ?? DEFAULT_LIMIT;
  const commentsPerItem = config.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;

  logger.info({ subreddits, sort, timeframe, limit, commentsPerItem }, "collection started");

  const seenIds = new Set<string>();
  const allItems: ParsedItem[] = [];

  for (const subreddit of subreddits) {
    const url = buildListingUrl(subreddit, sort, timeframe, limit);

    try {
      const data = await fetchWithRetry(fetchFn, url);
      const items = parseListingItems(data);

      let added = 0;
      for (const item of items) {
        if (!seenIds.has(item.externalId)) {
          seenIds.add(item.externalId);
          allItems.push(item);
          added++;
        }
      }
      logger.info({ subreddit, fetched: items.length, added }, "subreddit fetched");
    } catch (err) {
      logger.error({ subreddit, error: err instanceof Error ? err.message : String(err) }, "failed to fetch subreddit");
    }

    if (subreddit !== subreddits[subreddits.length - 1]) {
      await delay(RATE_LIMIT_MS);
    }
  }

  let totalComments = 0;

  if (commentsPerItem > 0) {
    let commentRequests = 0;
    for (const item of allItems) {
      if (item.engagement.commentCount < MIN_COMMENTS_FOR_FETCH) {
        continue;
      }

      if (commentRequests > 0) {
        await delay(COMMENT_RATE_LIMIT_MS);
      }
      commentRequests++;

      const comments = await fetchComments(
        fetchFn,
        item.subreddit,
        item.externalId,
        commentsPerItem,
      );
      item.comments = comments;
      totalComments += comments.length;

      if (comments.length === 0 && item.engagement.commentCount > 0) {
        logger.warn(
          { externalId: item.externalId, commentCount: item.engagement.commentCount },
          "comment fetch returned empty",
        );
      }
    }
  }

  let itemsStored = 0;

  if (allItems.length > 0) {
    const rows: RawItemInsert[] = allItems.map((item) => ({
      sourceType: "reddit" as const,
      externalId: item.externalId,
      title: item.title,
      url: item.url,
      sourceUrl: item.sourceUrl,
      author: item.author,
      content: item.content,
      publishedAt: item.publishedAt,
      collectedAt: new Date(),
      engagement: item.engagement,
      metadata: { comments: item.comments },
      updatedAt: new Date(),
    }));

    await deps.rawItemsRepo.upsertItems(rows);
    itemsStored = allItems.length;
  }

  const result = {
    itemsFetched: allItems.length,
    commentsFetched: totalComments,
    itemsStored,
    durationMs: Date.now() - startTime,
  };

  logger.info(result, "collection completed");

  return result;
}
