import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult, RawItemComment, RawItemEngagement } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay, fetchWithRetry, MAX_RETRIES, RATE_LIMIT_MS } from "@pipeline/collectors/utils.js";

const logger = createLogger("collector:reddit");

const DEFAULT_SUBREDDITS = [
  "MachineLearning", "LocalLLaMA", "artificial", "OpenAI",
  "AI_Agents", "aiagents", "generativeAI",
];
const DEFAULT_SORT = "top";
const DEFAULT_TIMEFRAME = "day";
const DEFAULT_LIMIT = 25;
const DEFAULT_COMMENTS_PER_ITEM = 10;
const COMMENT_RATE_LIMIT_MS = 2000;
const MIN_COMMENTS_FOR_FETCH = 5;
const MS_PER_SECOND = 1000;
const USER_AGENT = "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";
const REDDIT_HEADERS = { "User-Agent": USER_AGENT, "Accept": "application/json" };

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

function isRedditListing(value: unknown): value is RedditListing<RedditPostData> {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("data" in value)) return false;
  const data = (value as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return false;
  if (!("children" in data)) return false;
  return Array.isArray((data as Record<string, unknown>).children);
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
    const collectedAt = new Date();

    items.push({
      sourceType: "reddit" as const,
      externalId: post.id,
      title: post.title,
      url: postUrl,
      sourceUrl: `https://www.reddit.com${post.permalink}`,
      author: post.author,
      content: post.selftext,
      publishedAt: new Date(post.created_utc * MS_PER_SECOND),
      collectedAt,
      engagement,
      metadata: { comments: [] },
      updatedAt: collectedAt,
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
    const data = await fetchWithRetry(fetchFn, url, { headers: REDDIT_HEADERS, retries: MAX_RETRIES });

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
        publishedAt: new Date(comment.created_utc * MS_PER_SECOND).toISOString(),
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
  const allItems: RawItemInsert[] = [];
  const subredditByExternalId = new Map<string, string>();

  for (const subreddit of subreddits) {
    const url = buildListingUrl(subreddit, sort, timeframe, limit);

    try {
      const data = await fetchWithRetry(fetchFn, url, { headers: REDDIT_HEADERS, retries: MAX_RETRIES });
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
      if (!item.engagement || item.engagement.commentCount < MIN_COMMENTS_FOR_FETCH) {
        continue;
      }

      if (commentRequests > 0) {
        await delay(COMMENT_RATE_LIMIT_MS);
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

  let itemsStored = 0;

  if (allItems.length > 0) {
    await deps.rawItemsRepo.upsertItems(allItems);
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
