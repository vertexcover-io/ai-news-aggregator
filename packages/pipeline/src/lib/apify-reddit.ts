/**
 * Apify `trudax/reddit-scraper-lite` SDK wrapper.
 *
 * - buildListingInput / buildPostInput: pure functions for building actor inputs
 *   (verified against library-probe.md canonical input contract).
 * - runRedditListing / runRedditPost: SDK calls that return ApifyRedditPost[].
 * - mapApifyPostToRawItem: pure mapping from actor output → RawItemInsert.
 *
 * REQ-024: the token is NEVER logged — only the runId (bare string) is emitted.
 */
import { ApifyClient } from "apify-client";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemEngagement } from "@newsletter/shared/types";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("lib:apify-reddit");

/** The single actor used for all Reddit collection. Swap is a one-file change. */
export const ACTOR = "trudax/reddit-scraper-lite";

/** Wait at most 3 minutes per actor run (actor handles its own retries). */
const WAIT_SECS = 180;

// ── Actor I/O types (narrow — only fields we use) ───────────────────────────

/** A post-type item returned by the actor (dataType === "post"). */
export interface ApifyRedditPost {
  parsedId: string;
  title: string;
  /** Permalink to the Reddit post itself. */
  url: string;
  /** External article link if the post links out; absent for self-posts. */
  link?: string;
  username: string;
  body?: string;
  /** ISO-8601 string (e.g. "2026-06-01T12:00:00.000Z"). */
  createdAt: string;
  upVotes: number;
  numberOfComments: number;
  parsedCommunityName: string;
  imageUrls?: string[];
  dataType: string;
}

/** Minimal actor input shape (per library-probe.md verified contract). */
export interface ApifyActorInput {
  startUrls: { url: string }[];
  skipComments: boolean;
  skipUserPosts: boolean;
  skipCommunity: boolean;
  includeMediaLinks: boolean;
  maxPostCount?: number;
  maxItems: number;
  proxy: { useApifyProxy: boolean; apifyProxyGroups: string[] };
}

// ── Pure input builders ──────────────────────────────────────────────────────

/**
 * Build the actor input for a subreddit listing run.
 * Sort-path rule (library-probe.md):
 *   - sort=top  → /r/<sub>/top/?t=<timeframe>
 *   - sort∈{new,hot} → /r/<sub>/<sort>/   (no ?t=)
 */
export function buildListingInput(
  subreddits: string[],
  sort: string,
  timeframe: string,
  limit: number,
): ApifyActorInput {
  const startUrls = subreddits.map((sub) => {
    const base = `https://www.reddit.com/r/${sub}`;
    const url =
      sort === "top"
        ? `${base}/top/?t=${timeframe}`
        : `${base}/${sort}/`;
    return { url };
  });

  return {
    startUrls,
    skipComments: true,
    skipUserPosts: true,
    skipCommunity: true,
    includeMediaLinks: true,
    maxPostCount: limit,
    maxItems: limit * subreddits.length,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  };
}

/**
 * Build the actor input for a single-post fetch.
 */
export function buildPostInput(permalink: string): ApifyActorInput {
  return {
    startUrls: [{ url: permalink }],
    skipComments: true,
    skipUserPosts: true,
    skipCommunity: true,
    includeMediaLinks: true,
    maxItems: 1,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  };
}

// ── Pure mapper ──────────────────────────────────────────────────────────────

/**
 * Map one actor post item to a RawItemInsert.
 * Returns null when required fields are missing (EDGE-004: skip malformed).
 *
 * Field mapping per library-probe.md:
 *   externalId     ← parsedId
 *   url            ← link ?? url  (external link if present, else permalink)
 *   sourceUrl      ← url          (permalink)
 *   engagement     ← { points: upVotes, commentCount: numberOfComments }
 *   imageUrl       ← imageUrls?.[0]
 *   metadata.sourceUnit ← parsedCommunityName → { identifier:"r/<name>", displayName:"r/<name>" }
 */
export function mapApifyPostToRawItem(
  post: ApifyRedditPost,
  now: Date,
): RawItemInsert | null {
  // Validate required fields (EDGE-004)
  if (!post.parsedId || !post.title || !post.url) return null;

  const engagement: RawItemEngagement = {
    points: post.upVotes,
    commentCount: post.numberOfComments,
  };

  const subName = post.parsedCommunityName;

  return {
    sourceType: "reddit",
    externalId: post.parsedId,
    title: post.title,
    url: post.link ?? post.url, // external link if present, else permalink
    sourceUrl: post.url,        // permalink
    author: post.username || null,
    content: post.body ?? "",
    publishedAt: new Date(post.createdAt),
    collectedAt: now,
    engagement,
    metadata: {
      comments: [],
      sourceUnit: {
        identifier: `r/${subName}`,
        displayName: `r/${subName}`,
      },
    },
    imageUrl: post.imageUrls?.[0],
    updatedAt: now,
  };
}

// ── SDK runners ──────────────────────────────────────────────────────────────

/**
 * Run the actor for a subreddit listing.
 * REQ-024: logs only the bare runId, never the token.
 */
export async function runRedditListing(
  token: string,
  input: ApifyActorInput,
  _opts?: { signal?: AbortSignal },
): Promise<ApifyRedditPost[]> {
  const client = new ApifyClient({ token });
  const run = await client.actor(ACTOR).call(input, { waitSecs: WAIT_SECS });
  logger.info({ event: "apify.reddit.listing.run", runId: run.id }, "apify listing run completed");
  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  return (dataset.items as unknown as ApifyRedditPost[]).filter((item) => item.dataType === "post");
}

/**
 * Run the actor for a single Reddit post by permalink.
 * REQ-024: logs only the bare runId, never the token.
 */
export async function runRedditPost(
  token: string,
  permalink: string,
  _opts?: { signal?: AbortSignal },
): Promise<ApifyRedditPost[]> {
  const input = buildPostInput(permalink);
  const client = new ApifyClient({ token });
  const run = await client.actor(ACTOR).call(input, { waitSecs: WAIT_SECS });
  logger.info({ event: "apify.reddit.post.run", runId: run.id }, "apify post run completed");
  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  return (dataset.items as unknown as ApifyRedditPost[]).filter((item) => item.dataType === "post");
}
