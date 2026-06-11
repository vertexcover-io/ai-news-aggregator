import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { rawItems, runArchives } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createTwitterApiClient, createTwitterNotifier } from "@pipeline/social/twitter/index.js";
import { handleTwitterPostJob } from "@pipeline/workers/twitter-post.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import { closeTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb, RawItemInsert } from "@newsletter/shared/db";
import { AGENTLOOP_TENANT_ID, type SocialMetadata } from "@newsletter/shared";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const TWITTER_TWEETS_URL = "https://api.x.com/2/tweets";

const server = setupServer();

interface ArchiveTwitterState {
  readonly twitterPostedAt: Date | null;
  readonly socialMetadata: SocialMetadata | null;
}

async function loadArchiveTwitterState(
  db: AppDb,
  runId: string,
): Promise<ArchiveTwitterState> {
  const rows = await db
    .select({
      twitterPostedAt: runArchives.twitterPostedAt,
      socialMetadata: runArchives.socialMetadata,
    })
    .from(runArchives)
    .where(eq(runArchives.id, runId));
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Archive ${runId} was not found`);
  }
  return row;
}

async function seedReviewedArchive(
  db: AppDb,
  options: {
    readonly twitterPostedAt?: Date | null;
    readonly completedAt?: Date;
    readonly reviewed?: boolean;
  } = {},
): Promise<string> {
  const runId = randomUUID();
  const raw: RawItemInsert = {
    tenantId: AGENTLOOP_TENANT_ID,
    sourceType: "hn",
    externalId: `twitter-worker-${runId}`,
    title: "Small models gain enterprise traction",
    url: "https://example.com/small-models",
    publishedAt: new Date(),
    engagement: { points: 100, commentCount: 12 },
    metadata: {
      comments: [],
      recap: {
        title: "Small models gain traction",
        summary: "Specialised models are finding a clear enterprise niche.",
        bullets: ["Teams are trading broad capability for predictable cost"],
        bottomLine: "Small models now have a clearer production lane.",
      },
    },
  };
  const inserted = await db.insert(rawItems).values(raw).returning({ id: rawItems.id });
  const firstRawItem = inserted[0];
  if (firstRawItem === undefined) {
    throw new Error("Failed to seed raw item");
  }

  await db.insert(runArchives).values({
            tenantId: AGENTLOOP_TENANT_ID,
    id: runId,
    status: "completed",
    rankedItems: [
      {
        rawItemId: firstRawItem.id,
        score: 0.97,
        rationale: "seeded twitter worker e2e item",
      },
    ],
    topN: 1,
    reviewed: options.reviewed ?? true,
    completedAt: options.completedAt ?? new Date(),
    digestHeadline: "Small models find enterprise traction",
    digestSummary: "Specialised models are becoming a practical deployment option.",
    hook: "Small models are finding their production lane.",
    twitterSummary: "Small models are becoming the pragmatic enterprise AI bet.",
    twitterPostedAt: options.twitterPostedAt ?? null,
  });

  return runId;
}

function createNotifier(db: AppDb) {
  const archiveRepo = createRunArchivesRepo(db);
  return {
    archiveRepo,
    notifier: createTwitterNotifier({
      apiClient: createTwitterApiClient({
        appKey: "twitter-api-key",
        appSecret: "twitter-api-secret",
        accessToken: "twitter-access-token",
        accessSecret: "twitter-access-secret",
      }),
      archives: archiveRepo,
      rawItems: createRawItemsRepo(db),
      config: {
        publicArchiveBaseUrl: "https://newsletter.example.com",
      },
      logger: createLogger("twitter-post-e2e"),
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    }),
  };
}

describe("twitter-post worker e2e", () => {
  let db: AppDb;
  let twitterRequests: readonly string[];

  beforeAll(() => {
    db = getTestDb();
    server.listen({ onUnhandledRequest: "error" });
  });

  beforeEach(async () => {
    twitterRequests = [];
    await db.delete(runArchives);
    await db.delete(rawItems);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await closeTestRedis();
  });

  it("REQ-WK-3 posts a head tweet and reply, then records both tweet ids", async () => {
    const runId = await seedReviewedArchive(db);
    server.use(
      http.post(TWITTER_TWEETS_URL, ({ request }) => {
        const tweetId = twitterRequests.length === 0 ? "1800000000000000001" : "1800000000000000002";
        twitterRequests = [...twitterRequests, request.url];
        return HttpResponse.json({ data: { id: tweetId, text: "posted" } }, { status: 201 });
      }),
    );
    const { archiveRepo, notifier } = createNotifier(db);

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier: notifier },
      { name: "twitter-post", data: { runId } },
    );

    const state = await loadArchiveTwitterState(db, runId);
    expect(twitterRequests).toEqual([TWITTER_TWEETS_URL, TWITTER_TWEETS_URL]);
    expect(state.twitterPostedAt).not.toBeNull();
    expect(state.socialMetadata?.twitterThreadIds).toEqual([
      "1800000000000000001",
      "1800000000000000002",
    ]);
  });

  it("REQ-WK-4 marks the head tweet as posted without recording a social failure when the reply fails", async () => {
    const runId = await seedReviewedArchive(db);
    server.use(
      http.post(TWITTER_TWEETS_URL, ({ request }) => {
        const requestIndex = twitterRequests.length;
        twitterRequests = [...twitterRequests, request.url];
        if (requestIndex === 1) {
          return HttpResponse.json({ detail: "reply failed" }, { status: 500 });
        }
        return HttpResponse.json(
          { data: { id: "1800000000000000100", text: "posted" } },
          { status: 201 },
        );
      }),
    );
    const { archiveRepo, notifier } = createNotifier(db);

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier: notifier },
      { name: "twitter-post", data: { runId } },
    );

    const state = await loadArchiveTwitterState(db, runId);
    expect(twitterRequests).toEqual([TWITTER_TWEETS_URL, TWITTER_TWEETS_URL]);
    expect(state.twitterPostedAt).not.toBeNull();
    expect(state.socialMetadata?.twitterThreadIds).toEqual(["1800000000000000100"]);
    expect(state.socialMetadata?.twitterError).toBeUndefined();
  });

  it("REQ-006 posts the targeted (older) archive, not the newer/latest one", async () => {
    // Seed an OLDER archive (earlier completedAt so findLatestTerminal would skip it)
    const olderRunId = await seedReviewedArchive(db, {
      completedAt: new Date("2026-05-19T00:00:00.000Z"),
    });
    // Seed a NEWER archive (later completedAt — this is what findLatestTerminal would return)
    await seedReviewedArchive(db, {
      completedAt: new Date("2026-05-20T00:00:00.000Z"),
    });

    server.use(
      http.post(TWITTER_TWEETS_URL, ({ request }) => {
        const tweetId = twitterRequests.length === 0 ? "1900000000000000001" : "1900000000000000002";
        twitterRequests = [...twitterRequests, request.url];
        return HttpResponse.json({ data: { id: tweetId, text: "posted" } }, { status: 201 });
      }),
    );

    const { archiveRepo, notifier } = createNotifier(db);

    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier: notifier },
      { name: "twitter-post", data: { runId: olderRunId } },
    );

    // The older archive must be marked as posted
    const olderState = await loadArchiveTwitterState(db, olderRunId);
    expect(olderState.twitterPostedAt).not.toBeNull();
    expect(olderState.socialMetadata?.twitterThreadIds).toContain("1900000000000000001");
    // Exactly two Twitter API calls (head + reply)
    expect(twitterRequests).toEqual([TWITTER_TWEETS_URL, TWITTER_TWEETS_URL]);
  });

  it("EDGE-002 is idempotent: second job with same runId no-ops once twitterPostedAt is set", async () => {
    const runId = await seedReviewedArchive(db);

    server.use(
      http.post(TWITTER_TWEETS_URL, ({ request }) => {
        const tweetId = twitterRequests.length === 0 ? "1900000000000000010" : "1900000000000000011";
        twitterRequests = [...twitterRequests, request.url];
        return HttpResponse.json({ data: { id: tweetId, text: "posted" } }, { status: 201 });
      }),
    );

    const { archiveRepo, notifier: firstNotifier } = createNotifier(db);

    // First job — should post and set twitterPostedAt
    await handleTwitterPostJob(
      { archiveRepo, twitterNotifier: firstNotifier },
      { name: "twitter-post", data: { runId } },
    );

    const afterFirstJob = await loadArchiveTwitterState(db, runId);
    expect(afterFirstJob.twitterPostedAt).not.toBeNull();
    const requestsAfterFirst = twitterRequests.length;
    expect(requestsAfterFirst).toBeGreaterThan(0);

    // Second job with same runId — twitterPostedAt is now set; notifier must NOT be called
    const { archiveRepo: archiveRepo2, notifier: secondNotifier } = createNotifier(db);
    await handleTwitterPostJob(
      { archiveRepo: archiveRepo2, twitterNotifier: secondNotifier },
      { name: "twitter-post", data: { runId } },
    );

    expect(twitterRequests.length).toBe(requestsAfterFirst);
  });
});
