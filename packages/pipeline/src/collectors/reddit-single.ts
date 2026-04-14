import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemComment } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import { UrlParseError } from "@pipeline/collectors/hn-single.js";

const logger = createLogger("collector:reddit-single");

const USER_AGENT =
  "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";

export interface FetchRedditPostDeps {
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
  data: { children: RedditChild<T>[] };
}

const INVALID_THUMBNAILS = new Set(["self", "default", "nsfw", "", "spoiler"]);

function extractImageUrl(post: RedditPostData): string | null {
  const previewUrl = post.preview?.images[0]?.source.url;
  if (previewUrl) return previewUrl.replaceAll("&amp;", "&");
  if (
    post.thumbnail &&
    !INVALID_THUMBNAILS.has(post.thumbnail) &&
    /^https?:\/\//.test(post.thumbnail)
  ) {
    return post.thumbnail;
  }
  return null;
}

function isRedditCommentsResponse(
  value: unknown,
): value is [RedditListing<RedditPostData>, RedditListing<RedditCommentData>] {
  return Array.isArray(value) && value.length >= 2;
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

  const fetchFn = deps.fetchFn ?? fetch;
  const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  const jsonUrl = `${cleanUrl}.json`;

  logger.info(
    { event: "reddit.single.fetch", ...parsed, url },
    "reddit.single.fetch",
  );

  const response = await fetchFn(jsonUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
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
    imageUrl: extractImageUrl(post),
    updatedAt: now,
  };
}
