import { Scraper } from "agent-twitter-client";
import type { RawItemInsert } from "@newsletter/shared/db";
import type {
  CollectorResult,
  RawItemTwitterMetadata,
  RawItemTwitterOrigin,
} from "@newsletter/shared/types";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";

const logger = createLogger("collector:twitter");

const RATE_LIMIT_MS = 1000;

// ---------------------------------------------------------------------------
// Library shape — narrow interface so we can mock without pulling the lib
// ---------------------------------------------------------------------------

export interface TwitterTweet {
  id?: string;
  text?: string;
  permanentUrl?: string;
  username?: string;
  name?: string;
  timeParsed?: Date;
  likes?: number;
  replies?: number;
  retweets?: number;
  views?: number;
  isRetweet?: boolean;
  isReply?: boolean;
  photos?: { id: string; url: string; alt_text?: string }[];
  quotedStatus?: TwitterTweet;
}

export interface TwitterClient {
  setCookies(cookies: unknown[]): Promise<void>;
  isLoggedIn?(): Promise<boolean>;
  me?(): Promise<{ username?: string } | null | undefined>;
  getTweets(handle: string, max: number): AsyncIterable<TwitterTweet> | Promise<TwitterTweet[]>;
  fetchListTweets(
    listId: string,
    max: number,
  ): Promise<{ tweets: TwitterTweet[] } | TwitterTweet[]>;
}

export type TwitterClientFactory = () => TwitterClient;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class TwitterAuthError extends Error {
  override name = "TwitterAuthError" as const;
}

export class TwitterRateLimitError extends Error {
  override name = "TwitterRateLimitError" as const;
  readonly partialItemCount: number;
  constructor(message: string, partialItemCount: number) {
    super(message);
    this.partialItemCount = partialItemCount;
  }
}

export class TwitterFetchError extends Error {
  override name = "TwitterFetchError" as const;
}

// ---------------------------------------------------------------------------
// Public deps
// ---------------------------------------------------------------------------

export interface TwitterCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  signal?: AbortSignal;
  clientFactory?: TwitterClientFactory;
  envCookies?: string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseCookieEnv(raw: string | undefined): unknown[] {
  if (!raw || raw.length === 0) {
    throw new TwitterAuthError("TWITTER_COOKIES_JSON not set");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new TwitterAuthError(
      `invalid TWITTER_COOKIES_JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new TwitterAuthError("invalid cookie shape");
  }
  for (const c of parsed) {
    if (typeof c !== "object" || c === null) {
      throw new TwitterAuthError("invalid cookie shape");
    }
    const rec = c as Record<string, unknown>;
    if (typeof rec.name !== "string") {
      throw new TwitterAuthError("invalid cookie shape");
    }
    if (typeof rec.value !== "string") {
      throw new TwitterAuthError("invalid cookie shape");
    }
  }
  return parsed as unknown[];
}

export function buildTitle(text: string): string {
  if (text.length === 0) return "[media]";
  if (text.length <= 200) return text;
  return text.slice(0, 199) + "…";
}

export function buildContent(text: string, quoted?: TwitterTweet): string {
  if (!quoted) return text;
  return `${text}\n\n> ${quoted.text ?? ""}`;
}

export function pickImageUrl(tweet: TwitterTweet): string | null {
  return tweet.photos?.[0]?.url ?? null;
}

export function toRawItem(
  tweet: TwitterTweet,
  origin: RawItemTwitterOrigin,
): RawItemInsert | null {
  if (!tweet.id) {
    logger.warn({ origin }, "tweet missing id; dropping");
    return null;
  }

  const text = tweet.text ?? "";
  const username = tweet.username ?? "unknown";
  const permanentUrl =
    tweet.permanentUrl ?? `https://x.com/${username}/status/${tweet.id}`;

  let publishedAt: Date;
  if (tweet.timeParsed) {
    publishedAt = tweet.timeParsed;
  } else {
    logger.warn({ tweetId: tweet.id }, "tweet missing timeParsed; using now");
    publishedAt = new Date();
  }

  const twitterMeta: RawItemTwitterMetadata = {
    origin,
    retweetCount: tweet.retweets ?? 0,
    viewCount: tweet.views ?? null,
    displayName: tweet.name ?? null,
    isReply: tweet.isReply ?? false,
  };

  return {
    sourceType: "twitter",
    externalId: tweet.id,
    title: buildTitle(text),
    url: permanentUrl,
    sourceUrl: permanentUrl,
    author: username,
    content: buildContent(text, tweet.quotedStatus),
    publishedAt,
    collectedAt: new Date(),
    engagement: { points: tweet.likes ?? 0, commentCount: tweet.replies ?? 0 },
    metadata: {
      comments: [],
      twitter: twitterMeta,
    },
    imageUrl: pickImageUrl(tweet),
    updatedAt: new Date(),
  };
}

async function asArray<T>(
  v: AsyncIterable<T> | Promise<T[]> | T[],
): Promise<T[]> {
  if (Array.isArray(v)) return v;
  if (v instanceof Promise) return v;
  const result: T[] = [];
  for await (const item of v) {
    result.push(item);
  }
  return result;
}

async function unwrapListResult(
  v: Promise<{ tweets: TwitterTweet[] } | TwitterTweet[]>,
): Promise<TwitterTweet[]> {
  const result = await v;
  if (Array.isArray(result)) return result;
  return result.tweets;
}

async function probeAuth(client: TwitterClient): Promise<boolean> {
  try {
    if (client.isLoggedIn) {
      return await client.isLoggedIn();
    }
    if (client.me) {
      const profile = await client.me();
      return profile != null;
    }
    // No probe method available — assume logged in
    return true;
  } catch {
    return false;
  }
}

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("too many requests")
  );
}

interface CookieJson {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

export function cookiesToStrings(cookies: unknown[]): string[] {
  return cookies.map((c) => {
    const cookie = c as CookieJson;
    const parts = [`${cookie.name}=${cookie.value}`];
    parts.push("Domain=.twitter.com");
    parts.push(`Path=${cookie.path ?? "/"}`);
    if (cookie.secure) parts.push("Secure");
    if (cookie.httpOnly) parts.push("HttpOnly");
    if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`);
    return parts.join("; ");
  });
}

function defaultClientFactory(): TwitterClient {
  const scraper = new Scraper();
  return {
    setCookies: (cookies) => scraper.setCookies(cookiesToStrings(cookies)),
    isLoggedIn: () => scraper.isLoggedIn(),
    getTweets: (handle, max) => scraper.getTweets(handle, max),
    fetchListTweets: (listId, max) => scraper.fetchListTweets(listId, max),
  };
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export async function collectTwitter(
  deps: TwitterCollectorDeps,
  config: TwitterCollectConfig,
): Promise<CollectorResult> {
  const start = Date.now();

  const cookies = parseCookieEnv(deps.envCookies ?? process.env.TWITTER_COOKIES_JSON);

  if (config.users.length + config.listIds.length === 0) {
    return {
      itemsFetched: 0,
      itemsStored: 0,
      commentsFetched: 0,
      durationMs: Date.now() - start,
    };
  }

  const client = (deps.clientFactory ?? defaultClientFactory)();
  await client.setCookies(cookies);

  // Auth probe is a SOFT signal: agent-twitter-client@0.0.18 calls a deprecated
  // X v1.1 endpoint (verify_credentials.json) that now 404s for everyone, so
  // isLoggedIn() returns false even on valid sessions. Log the result, but let
  // the real work (getTweets/fetchListTweets) be the authoritative auth test —
  // on bad cookies those throw 401, which the per-source catch surfaces.
  try {
    const loggedIn = await probeAuth(client);
    if (!loggedIn) {
      logger.warn(
        { event: "twitter.probe.soft_fail" },
        "isLoggedIn returned false; continuing — getTweets is the authoritative auth check",
      );
    }
  } catch (err) {
    logger.warn(
      {
        event: "twitter.probe.error",
        error: err instanceof Error ? err.message : String(err),
      },
      "isLoggedIn threw; continuing — getTweets is the authoritative auth check",
    );
  }

  const items: RawItemInsert[] = [];

  interface SourceDef {
    run: () => Promise<TwitterTweet[]>;
    origin: RawItemTwitterOrigin;
    label: string;
  }

  const allSources: SourceDef[] = [
    ...config.users.map((handle) => ({
      run: () => asArray(client.getTweets(handle, config.maxPerSource)),
      origin: { kind: "user" as const, handle },
      label: `user:${handle}`,
    })),
    ...config.listIds.map((listId) => ({
      run: () => unwrapListResult(client.fetchListTweets(listId, config.maxPerSource)),
      origin: { kind: "list" as const, listId },
      label: `list:${listId}`,
    })),
  ];

  let isFirst = true;
  for (const src of allSources) {
    if (deps.signal?.aborted) break;
    if (!isFirst) {
      await delay(RATE_LIMIT_MS, deps.signal).catch(() => {
        // signal was aborted during delay — break on next iteration check
      });
    }
    isFirst = false;
    if (deps.signal?.aborted) break;

    try {
      const tweets = await src.run();
      for (const t of tweets) {
        if (t.isRetweet) continue;
        const item = toRawItem(t, src.origin);
        if (item) items.push(item);
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        logger.warn({ source: src.label }, "twitter rate-limited; stopping");
        // Upsert whatever items were already collected before the rate-limit hit
        const cutoffPartial = Date.now() - config.sinceDays * 86_400_000;
        const partialFiltered = items.filter(
          (it) => it.publishedAt && it.publishedAt.getTime() >= cutoffPartial,
        );
        if (partialFiltered.length > 0) {
          await deps.rawItemsRepo.upsertItems(partialFiltered);
        }
        throw new TwitterRateLimitError(
          `rate-limited at ${src.label}`,
          partialFiltered.length,
        );
      }
      logger.warn(
        {
          source: src.label,
          error: err instanceof Error ? err.message : String(err),
        },
        "twitter source failed",
      );
    }
  }

  const cutoff = Date.now() - config.sinceDays * 86_400_000;
  const filtered = items.filter(
    (it) => it.publishedAt && it.publishedAt.getTime() >= cutoff,
  );

  let itemsStored = 0;
  if (filtered.length > 0) {
    await deps.rawItemsRepo.upsertItems(filtered);
    itemsStored = filtered.length;
  }

  const result: CollectorResult = {
    itemsFetched: filtered.length,
    commentsFetched: 0,
    itemsStored,
    durationMs: Date.now() - start,
  };

  logger.info(result, "twitter collection completed");

  return result;
}
