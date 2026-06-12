import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { collectTwitter } from "@pipeline/collectors/twitter/index.js";
import type {
  NormalizedTweet,
  TwitterClient,
} from "@pipeline/collectors/twitter/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createSourceRateLimiter } from "@pipeline/services/source-rate-limit.js";
import {
  closeTestRedis,
  getTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";

const ORIGINAL_RETTIWT_API_KEY = process.env.RETTIWT_API_KEY;

function makeTweet(id: string): NormalizedTweet {
  return {
    id,
    authorHandle: "alice",
    fullText: `tweet ${id}`,
    createdAt: "2026-06-10T00:00:00.000Z",
    eventCreatedAt: "2026-06-10T00:00:00.000Z",
    url: `https://x.com/alice/status/${id}`,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    photoUrls: [],
    isRetweet: false,
    isQuote: false,
  };
}

function makeFakeRepo(): RawItemsRepo {
  return {
    upsertItems: () => Promise.resolve(),
    findExistingExternalIds: () => Promise.resolve(new Set<string>()),
    findBySourceAndExternalId: () => Promise.resolve(null),
    updateRecapData: () => Promise.resolve(),
  } as unknown as RawItemsRepo;
}

/** Fake client: each list source pages 3 times; records fetch instants. */
function makePagingClient(fetchTimes: number[]): TwitterClient {
  return {
    fetchListTweets: (listId, opts) => {
      fetchTimes.push(Date.now());
      const page = opts?.cursor === undefined ? 1 : Number(opts.cursor);
      return Promise.resolve({
        tweets: [makeTweet(`${listId}-p${page}-${randomUUID()}`)],
        nextCursor: page < 3 ? String(page + 1) : null,
      });
    },
    fetchUserTimeline: () =>
      Promise.resolve({ tweets: [], nextCursor: null }),
  };
}

// P10 (REQ-068): the SHARED Twitter collector draws every page fetch from one
// GLOBAL Redis token bucket — two tenants collecting concurrently are paced
// together, keeping the combined call rate under the upstream budget.
describe("twitter collector global throttle (shared Redis limiter)", () => {
  let keyPrefix: string;

  beforeEach(() => {
    process.env.RETTIWT_API_KEY = "seam-fake-key";
    keyPrefix = `source-rate:test:${randomUUID()}`;
  });

  afterEach(async () => {
    if (ORIGINAL_RETTIWT_API_KEY === undefined) {
      delete process.env.RETTIWT_API_KEY;
    } else {
      process.env.RETTIWT_API_KEY = ORIGINAL_RETTIWT_API_KEY;
    }
    const redis = getTestRedis();
    const keys = await redis.keys(`${keyPrefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  it("test_REQ_068_twitter_collector_globally_throttled", async () => {
    // ~1 page fetch per 100ms across ALL tenants
    const limiter = createSourceRateLimiter(getTestRedis(), {
      keyPrefix,
      limits: { twitter: { capacity: 1, refillPerSecond: 10 } },
    });
    const throttle = (): Promise<void> => limiter.acquire("twitter");
    const fetchTimes: number[] = [];

    const tenantRun = (listId: string): ReturnType<typeof collectTwitter> =>
      collectTwitter(
        {
          client: makePagingClient(fetchTimes),
          rawItemsRepo: makeFakeRepo(),
          sleep: () => Promise.resolve(),
          throttle,
        },
        { listIds: [listId], users: [] },
      );

    const startedAt = Date.now();
    const [a, b] = await Promise.all([
      tenantRun("tenant-a-list"),
      tenantRun("tenant-b-list"),
    ]);
    const elapsedMs = Date.now() - startedAt;

    // both tenants collected fully (3 pages × 1 tweet each)...
    expect(a.itemsStored).toBe(3);
    expect(b.itemsStored).toBe(3);
    expect(fetchTimes).toHaveLength(6);
    // ...but their COMBINED 6 page fetches were paced by the shared bucket:
    // 5 refills at ≥100ms after the initial burst token (timer-slack headroom).
    expect(elapsedMs).toBeGreaterThanOrEqual(400);
  });
});
