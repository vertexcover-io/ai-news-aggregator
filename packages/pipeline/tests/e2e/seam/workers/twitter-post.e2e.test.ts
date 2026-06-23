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
import { createSocialTokensRepo } from "@pipeline/repositories/social-tokens.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { socialTokens } from "@newsletter/shared/db";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import { ensurePipelineTenant } from "@pipeline-tests/e2e/setup/tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { closeTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb, RawItemInsert } from "@newsletter/shared/db";
import type { SocialMetadata } from "@newsletter/shared";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const TWITTER_TWEETS_URL = "https://api.x.com/2/tweets";
const TWITTER_OAUTH_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const CIPHER_SESSION_SECRET = "twitter-post-e2e-session-secret-32-bytes!!";

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
    tenantId: tenant.tenantId,
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
    id: runId,
    tenantId: tenant.tenantId,
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
  const archiveRepo = createRunArchivesRepo(db, tenant);
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
      rawItems: createRawItemsRepo(db, tenant),
      config: {
        publicArchiveBaseUrl: "https://newsletter.example.com",
      },
      logger: createLogger("twitter-post-e2e"),
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    }),
  };
}

// tenant_id is NOT NULL on raw_items/run_archives — all seeds + repos stamp this
let tenant: TenantContext;

describe("twitter-post worker e2e", () => {
  let db: AppDb;
  let twitterRequests: readonly string[];

  beforeAll(async () => {
    db = getTestDb();
    tenant = await ensurePipelineTenant();
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

  // ── P13 (REQ-081): per-tenant OAuth2 posting — tenant tokens from
  //    social_tokens (real DB), refresh under the FOR UPDATE lock, mocked
  //    Twitter provider (msw). No live tweet, ever. ─────────────────────────
  describe("OAuth2 tenant-token posting (REQ-081)", () => {
    const cipher = getCredentialCipher({
      SESSION_SECRET: CIPHER_SESSION_SECRET,
    } as NodeJS.ProcessEnv);

    function tokensRepo() {
      return createSocialTokensRepo(db, cipher, tenant);
    }

    function createOAuth2Notifier() {
      const archiveRepo = createRunArchivesRepo(db, tenant);
      return {
        archiveRepo,
        notifier: createTwitterNotifier({
          oauth2: {
            tokens: tokensRepo(),
            clientId: "app-tw-client-id",
            clientSecret: "app-tw-client-secret",
          },
          archives: archiveRepo,
          rawItems: createRawItemsRepo(db, tenant),
          config: {
            publicArchiveBaseUrl: "https://newsletter.example.com",
          },
          logger: createLogger("twitter-post-oauth2-e2e"),
          now: () => new Date("2026-05-21T00:00:00.000Z"),
        }),
      };
    }

    beforeEach(async () => {
      await db.delete(socialTokens);
    });

    it("test_REQ_081_publish_path_posts_with_tenant_tokens — tweets carry the TENANT's bearer token; no refresh when fresh", async () => {
      const runId = await seedReviewedArchive(db);
      await tokensRepo().saveToken("twitter", {
        accessToken: "tenant-at-fresh",
        refreshToken: "tenant-rt-fresh",
        expiresAt: new Date("2026-05-22T00:00:00.000Z"), // fresh vs now=05-21
      });

      let authHeaders: string[] = [];
      server.use(
        http.post(TWITTER_TWEETS_URL, ({ request }) => {
          authHeaders = [...authHeaders, request.headers.get("authorization") ?? ""];
          const tweetId =
            authHeaders.length === 1 ? "2000000000000000001" : "2000000000000000002";
          return HttpResponse.json({ data: { id: tweetId, text: "posted" } }, { status: 201 });
        }),
      );

      const { archiveRepo, notifier } = createOAuth2Notifier();
      await handleTwitterPostJob(
        { archiveRepo, twitterNotifier: notifier },
        { name: "twitter-post", data: { runId } },
      );

      // Head tweet + link reply, both with the tenant's OAuth2 access token.
      expect(authHeaders).toEqual(["Bearer tenant-at-fresh", "Bearer tenant-at-fresh"]);
      const state = await loadArchiveTwitterState(db, runId);
      expect(state.twitterPostedAt).not.toBeNull();
      expect(state.socialMetadata?.twitterThreadIds).toEqual([
        "2000000000000000001",
        "2000000000000000002",
      ]);
    });

    it("expired tenant token → refreshed via the shared app client and rotated tokens persisted; post uses the NEW token", async () => {
      const runId = await seedReviewedArchive(db);
      await tokensRepo().saveToken("twitter", {
        accessToken: "tenant-at-stale",
        refreshToken: "tenant-rt-stale",
        expiresAt: new Date("2026-05-20T00:00:00.000Z"), // expired vs now=05-21
      });

      let refreshBodies: string[] = [];
      let authHeaders: string[] = [];
      server.use(
        http.post(TWITTER_OAUTH_TOKEN_URL, async ({ request }) => {
          refreshBodies = [...refreshBodies, await request.text()];
          return HttpResponse.json({
            access_token: "tenant-at-rotated",
            refresh_token: "tenant-rt-rotated",
            expires_in: 7200,
          });
        }),
        http.post(TWITTER_TWEETS_URL, ({ request }) => {
          authHeaders = [...authHeaders, request.headers.get("authorization") ?? ""];
          const tweetId =
            authHeaders.length === 1 ? "2000000000000000011" : "2000000000000000012";
          return HttpResponse.json({ data: { id: tweetId, text: "posted" } }, { status: 201 });
        }),
      );

      const { archiveRepo, notifier } = createOAuth2Notifier();
      await handleTwitterPostJob(
        { archiveRepo, twitterNotifier: notifier },
        { name: "twitter-post", data: { runId } },
      );

      // Refresh hit the OAuth2 token endpoint with the stored refresh token.
      expect(refreshBodies).toHaveLength(1);
      expect(refreshBodies[0]).toContain("grant_type=refresh_token");
      expect(refreshBodies[0]).toContain("refresh_token=tenant-rt-stale");
      // The post used the rotated access token.
      expect(authHeaders).toEqual(["Bearer tenant-at-rotated", "Bearer tenant-at-rotated"]);
      // The rotated tokens were persisted under (tenant, 'twitter') — the
      // tx.saveToken ran inside the FOR UPDATE lock against the real DB.
      const row = await tokensRepo().getToken("twitter");
      expect(row?.accessToken).toBe("tenant-at-rotated");
      expect(row?.refreshToken).toBe("tenant-rt-rotated");
      const state = await loadArchiveTwitterState(db, runId);
      expect(state.twitterPostedAt).not.toBeNull();
    });

    it("no tenant token row → channel skips without calling Twitter; run state untouched", async () => {
      const runId = await seedReviewedArchive(db);
      // msw: any tweet call would be an unhandled request error.
      const { archiveRepo, notifier } = createOAuth2Notifier();
      await handleTwitterPostJob(
        { archiveRepo, twitterNotifier: notifier },
        { name: "twitter-post", data: { runId } },
      );
      const state = await loadArchiveTwitterState(db, runId);
      expect(state.twitterPostedAt).toBeNull();
    });
  });
});
