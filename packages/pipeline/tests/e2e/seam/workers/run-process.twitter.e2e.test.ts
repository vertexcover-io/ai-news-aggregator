/**
 * Integration tests for Twitter source dispatch in run-process worker.
 * These are DB-backed and cover:
 *   - EDGE-002: same tweet via user and list → one row in raw_items
 *   - REQ-055: twitter failure does not block HN from producing items
 *   - EDGE-018: cookies missing → source failed but run completes
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { rawItems } from "@newsletter/shared/db";
import { eq } from "drizzle-orm";
import type { RunState } from "@newsletter/shared/types";
import {
  handleRunProcessJob,
  type CollectFns,
  type RunProcessJobLike,
} from "@pipeline/workers/run-process.js";
import type { CollectorResult } from "@newsletter/shared/types";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader.js";
import { createRunStateService } from "@pipeline/services/run-state.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createCandidatesRepo } from "@pipeline/repositories/candidates.js";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { CancelSubscriberFactory } from "@pipeline/services/cancel-subscriber.js";
import { TwitterAuthError } from "@pipeline/collectors/twitter.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const twitterConfig: TwitterCollectConfig = {
  users: ["openai"],
  listIds: [],
  maxPerSource: 20,
  sinceDays: 7,
};

const noopCancelSubscriber: CancelSubscriberFactory = {
  subscribe: () => Promise.resolve({ close: () => Promise.resolve() }),
};

function makeInitialRunState(runId: string): RunState {
  const now = new Date(Date.now() - 60 * 1000).toISOString();
  return {
    id: runId,
    status: "running",
    stage: "collecting",
    topN: 5,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources: {},
    rankedItems: null,
    warnings: [],
    error: null,
  };
}

describe("run-process twitter integration (Phase 3)", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
    return async () => {
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    await truncateAll();
    const connection = getTestRedis();
    const keys = await connection.keys("run:twitter-e2e-*");
    if (keys.length > 0) await connection.del(...keys);
  });

  // EDGE-002: same tweet ID via user and list → unique constraint → one row
  it("EDGE-002: same tweet upserted twice ends up as one row in raw_items", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = "twitter-e2e-edge-002";
    const rawItemsRepo = createRawItemsRepo(db);

    await runStateService.set(makeInitialRunState(runId));

    // This twitter mock upserts the same tweet twice (simulating user + list returning the same tweet)
    const twitterFn = async (): Promise<CollectorResult> => {
      const now = new Date();
      await rawItemsRepo.upsertItems([
        {
          sourceType: "twitter",
          externalId: "tweet-123",
          title: "Tweet 123",
          url: "https://x.com/openai/status/tweet-123",
          sourceUrl: "https://x.com/openai/status/tweet-123",
          author: "openai",
          content: "Tweet content",
          publishedAt: now,
          collectedAt: now,
          engagement: { points: 100, commentCount: 5 },
          metadata: { comments: [], twitter: { origin: { kind: "user", handle: "openai" }, retweetCount: 10, viewCount: 1000, displayName: "OpenAI", isReply: false } },
          imageUrl: null,
          updatedAt: now,
        },
      ]);
      // Second upsert same tweet with different origin (list)
      await rawItemsRepo.upsertItems([
        {
          sourceType: "twitter",
          externalId: "tweet-123",
          title: "Tweet 123",
          url: "https://x.com/openai/status/tweet-123",
          sourceUrl: "https://x.com/openai/status/tweet-123",
          author: "openai",
          content: "Tweet content",
          publishedAt: now,
          collectedAt: now,
          engagement: { points: 100, commentCount: 5 },
          metadata: { comments: [], twitter: { origin: { kind: "list", listId: "123456789" }, retweetCount: 10, viewCount: 1000, displayName: "OpenAI", isReply: false } },
          imageUrl: null,
          updatedAt: now,
        },
      ]);
      return { itemsFetched: 2, itemsStored: 2, commentsFetched: 0, durationMs: 10 };
    };

    const noopCollect: CollectFns["hn"] = (): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs: 0 });

    const collectFns: CollectFns = {
      hn: noopCollect,
      reddit: noopCollect,
      web: noopCollect,
      twitter: twitterFn,
    };

    const job: RunProcessJobLike = {
      name: "run-process",
      id: "e2e-edge-002",
      data: {
        runId,
        topN: 5,
        sourceTypes: ["twitter"],
        collectors: { twitter: twitterConfig },
      },
    };

    await handleRunProcessJob(
      {
        runState: runStateService,
        rawItemsRepo,
        candidatesRepo: createCandidatesRepo(db),
        archiveRepo: createRunArchivesRepo(db),
        loadFn: loadCandidatesSince,
        shortlistFn: (candidates) => Promise.resolve({ shortlist: candidates, breakdowns: [] }),
        rankFn: (candidates, opts) =>
          Promise.resolve({
            rankedItems: candidates.slice(0, opts.topN).map((c, i) => ({
              rawItemId: c.id,
              score: 1 - i * 0.1,
              rationale: "test",
            })),
            candidateCount: candidates.length,
            rankedCount: Math.min(candidates.length, opts.topN),
          }),
        collectFns,
        cancelSubscriber: noopCancelSubscriber,
      },
      job,
    );

    // Only one row should exist for tweet-123
    const rows = await db
      .select()
      .from(rawItems)
      .where(eq(rawItems.externalId, "tweet-123"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceType).toBe("twitter");
  });

  // REQ-055: twitter failure does not block HN from producing items
  it("REQ-055: twitter AuthError does not prevent HN items from landing in raw_items", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = "twitter-e2e-req-055";
    const rawItemsRepo = createRawItemsRepo(db);

    await runStateService.set(makeInitialRunState(runId));

    const twitterFn = (): Promise<CollectorResult> => {
      throw new TwitterAuthError("TWITTER_COOKIES_JSON not set");
    };

    const now = new Date();
    const hnFn = async (): Promise<CollectorResult> => {
      await rawItemsRepo.upsertItems([
        {
          sourceType: "hn",
          externalId: "hn-999",
          title: "HN Item from Twitter phase test",
          url: "https://example.com/hn-999",
          sourceUrl: "https://news.ycombinator.com/item?id=hn-999",
          author: "testuser",
          content: "HN content",
          publishedAt: now,
          collectedAt: now,
          engagement: { points: 50, commentCount: 3 },
          metadata: { comments: [] },
          imageUrl: null,
          updatedAt: now,
        },
      ]);
      return { itemsFetched: 1, itemsStored: 1, commentsFetched: 0, durationMs: 5 };
    };

    const noopCollect: CollectFns["hn"] = (): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs: 0 });

    const collectFns: CollectFns = {
      hn: hnFn,
      reddit: noopCollect,
      web: noopCollect,
      twitter: twitterFn,
    };

    const job: RunProcessJobLike = {
      name: "run-process",
      id: "e2e-req-055",
      data: {
        runId,
        topN: 5,
        sourceTypes: ["hn", "twitter"],
        collectors: {
          hn: { sinceDays: 1 },
          twitter: twitterConfig,
        },
      },
    };

    await handleRunProcessJob(
      {
        runState: runStateService,
        rawItemsRepo,
        candidatesRepo: createCandidatesRepo(db),
        archiveRepo: createRunArchivesRepo(db),
        loadFn: loadCandidatesSince,
        shortlistFn: (candidates) => Promise.resolve({ shortlist: candidates, breakdowns: [] }),
        rankFn: (candidates, opts) =>
          Promise.resolve({
            rankedItems: candidates.slice(0, opts.topN).map((c, i) => ({
              rawItemId: c.id,
              score: 1 - i * 0.1,
              rationale: "test",
            })),
            candidateCount: candidates.length,
            rankedCount: Math.min(candidates.length, opts.topN),
          }),
        collectFns,
        cancelSubscriber: noopCancelSubscriber,
      },
      job,
    );

    // HN item must be present
    const hnRows = await db
      .select()
      .from(rawItems)
      .where(eq(rawItems.externalId, "hn-999"));
    expect(hnRows).toHaveLength(1);
    expect(hnRows[0]?.sourceType).toBe("hn");

    // Twitter source must be marked failed in run-state
    const finalState = await runStateService.get(runId);
    expect(finalState?.sources.twitter?.status).toBe("failed");
    expect(finalState?.sources.twitter?.errors).toEqual(["TWITTER_COOKIES_JSON not set"]);
  });

  // EDGE-018: cookies missing → source failed but run completes (no throw to caller)
  it("EDGE-018: run completes even when twitter throws TwitterAuthError (cookies missing)", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = "twitter-e2e-edge-018";
    const rawItemsRepo = createRawItemsRepo(db);

    await runStateService.set(makeInitialRunState(runId));

    const twitterFn = (): Promise<CollectorResult> => {
      throw new TwitterAuthError("TWITTER_COOKIES_JSON not set");
    };

    const noopCollect: CollectFns["hn"] = (): Promise<CollectorResult> =>
      Promise.resolve({ itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs: 0 });

    const collectFns: CollectFns = {
      hn: noopCollect,
      reddit: noopCollect,
      web: noopCollect,
      twitter: twitterFn,
    };

    const job: RunProcessJobLike = {
      name: "run-process",
      id: "e2e-edge-018",
      data: {
        runId,
        topN: 5,
        sourceTypes: ["twitter"],
        collectors: { twitter: twitterConfig },
      },
    };

    // Should NOT throw — run completes even when twitter fails
    const result = await handleRunProcessJob(
      {
        runState: runStateService,
        rawItemsRepo,
        candidatesRepo: createCandidatesRepo(db),
        archiveRepo: createRunArchivesRepo(db),
        loadFn: loadCandidatesSince,
        shortlistFn: (candidates) => Promise.resolve({ shortlist: candidates, breakdowns: [] }),
        rankFn: (candidates, opts) =>
          Promise.resolve({
            rankedItems: candidates.slice(0, opts.topN).map((c, i) => ({
              rawItemId: c.id,
              score: 1 - i * 0.1,
              rationale: "test",
            })),
            candidateCount: candidates.length,
            rankedCount: Math.min(candidates.length, opts.topN),
          }),
        collectFns,
        cancelSubscriber: noopCancelSubscriber,
      },
      job,
    );

    // Run returns result (doesn't throw)
    expect(result).toEqual({ rankedCount: 0 });

    // Twitter source is "failed" in run-state
    const finalState = await runStateService.get(runId);
    expect(finalState?.sources.twitter?.status).toBe("failed");
    expect(finalState?.sources.twitter?.errors[0]).toContain("TWITTER_COOKIES_JSON not set");
  });
});
