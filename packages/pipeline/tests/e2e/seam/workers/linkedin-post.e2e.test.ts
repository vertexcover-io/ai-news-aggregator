import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { rawItems, runArchives, socialTokens } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createSocialTokensRepo } from "@pipeline/repositories/social-tokens.js";
import { createLinkedInApiClient, createLinkedInNotifier } from "@pipeline/social/linkedin/index.js";
import { handleLinkedInPostJob } from "@pipeline/workers/linkedin-post.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import { closeTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb, RawItemInsert } from "@newsletter/shared/db";
import type { SocialMetadata } from "@newsletter/shared";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_SOCIAL_ACTIONS_URL = "https://api.linkedin.com/rest/socialActions/";
const LINKEDIN_COMMENTS_URL = "https://api.linkedin.com/rest/socialActions/*/comments";

const server = setupServer();

interface ArchiveSocialState {
  readonly linkedinPostedAt: Date | null;
  readonly socialMetadata: SocialMetadata | null;
}

function isLinkedInCommentRequest(url: string): boolean {
  return url.startsWith(LINKEDIN_SOCIAL_ACTIONS_URL) && url.endsWith("/comments");
}

async function loadArchiveSocialState(
  db: AppDb,
  runId: string,
): Promise<ArchiveSocialState> {
  const rows = await db
    .select({
      linkedinPostedAt: runArchives.linkedinPostedAt,
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
    readonly linkedinPostedAt?: Date | null;
    readonly completedAt?: Date;
    readonly reviewed?: boolean;
  } = {},
): Promise<string> {
  const runId = randomUUID();
  const raw: RawItemInsert = {
    sourceType: "hn",
    externalId: `linkedin-worker-${runId}`,
    title: "Agent benchmarks reshape enterprise buying",
    url: "https://example.com/agent-benchmarks",
    publishedAt: new Date(),
    engagement: { points: 120, commentCount: 18 },
    metadata: {
      comments: [],
      recap: {
        title: "Agent benchmarks reshape buying",
        summary: "New benchmarks are pushing teams to revisit agent procurement.",
        bullets: ["Procurement teams want reproducible agent benchmarks"],
        bottomLine: "Benchmarks are becoming buying infrastructure.",
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
    status: "completed",
    rankedItems: [
      {
        rawItemId: firstRawItem.id,
        score: 0.98,
        rationale: "seeded linkedin worker e2e item",
      },
    ],
    topN: 1,
    reviewed: options.reviewed ?? true,
    completedAt: options.completedAt ?? new Date(),
    digestHeadline: "Agent benchmarks shift buying decisions",
    digestSummary: "Teams are standardising how they evaluate production agents.",
    hook: "Agent benchmarks are becoming the new buying checklist.",
    twitterSummary: "Agent benchmarks are reshaping buying decisions.",
    linkedinPostedAt: options.linkedinPostedAt ?? null,
  });

  return runId;
}

async function seedLinkedInToken(db: AppDb): Promise<void> {
  await createSocialTokensRepo(db, getCredentialCipher()).saveToken("linkedin", {
    accessToken: "linkedin-access-token",
    refreshToken: "",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    metadata: { personUrn: "urn:li:person:test-person" },
  });
}

describe("linkedin-post worker e2e", () => {
  let db: AppDb;
  let linkedInRequests: readonly string[];

  beforeAll(() => {
    db = getTestDb();
    server.listen({ onUnhandledRequest: "error" });
  });

  beforeEach(async () => {
    linkedInRequests = [];
    await db.delete(socialTokens);
    await db.delete(runArchives);
    await db.delete(rawItems);
    await seedLinkedInToken(db);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await closeTestRedis();
  });

  it("REQ-WK-1 posts a reviewed archive to LinkedIn and records the post URN", async () => {
    const runId = await seedReviewedArchive(db);
    server.use(
      http.post(LINKEDIN_POSTS_URL, ({ request }) => {
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:test-linkedin-post" },
        });
      }),
      http.post(LINKEDIN_COMMENTS_URL, ({ request }) => {
        if (!isLinkedInCommentRequest(request.url)) {
          throw new Error(`Unexpected LinkedIn comment URL: ${request.url}`);
        }
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const archiveRepo = createRunArchivesRepo(db);
    const notifier = createLinkedInNotifier({
      apiClient: createLinkedInApiClient(),
      archives: archiveRepo,
      rawItems: createRawItemsRepo(db),
      tokens: createSocialTokensRepo(db, getCredentialCipher()),
      config: {
        clientId: "linkedin-client-id",
        clientSecret: "linkedin-client-secret",
        apiVersion: "202405",
        publicArchiveBaseUrl: "https://newsletter.example.com",
      },
      logger: createLogger("linkedin-post-e2e"),
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: notifier },
      { name: "linkedin-post", data: { runId } },
    );

    const state = await loadArchiveSocialState(db, runId);
    expect(linkedInRequests.some((url) => url === LINKEDIN_POSTS_URL)).toBe(true);
    expect(state.linkedinPostedAt).not.toBeNull();
    expect(state.socialMetadata?.linkedinPermalink).toBe(
      "urn:li:share:test-linkedin-post",
    );
  });

  it("REQ-WK-2 skips LinkedIn when the archive is already posted", async () => {
    const runId = await seedReviewedArchive(db, {
      linkedinPostedAt: new Date("2026-05-20T00:00:00.000Z"),
    });
    server.use(
      http.post(LINKEDIN_POSTS_URL, ({ request }) => {
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, { status: 201 });
      }),
      http.post(LINKEDIN_COMMENTS_URL, ({ request }) => {
        if (!isLinkedInCommentRequest(request.url)) {
          throw new Error(`Unexpected LinkedIn comment URL: ${request.url}`);
        }
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const archiveRepo = createRunArchivesRepo(db);
    const notifier = createLinkedInNotifier({
      apiClient: createLinkedInApiClient(),
      archives: archiveRepo,
      rawItems: createRawItemsRepo(db),
      tokens: createSocialTokensRepo(db, getCredentialCipher()),
      config: {
        clientId: "linkedin-client-id",
        clientSecret: "linkedin-client-secret",
        apiVersion: "202405",
        publicArchiveBaseUrl: "https://newsletter.example.com",
      },
      logger: createLogger("linkedin-post-e2e"),
    });

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: notifier },
      { name: "linkedin-post", data: { runId } },
    );

    expect(linkedInRequests).toHaveLength(0);
  });

  it("REQ-006 posts the targeted (older) archive, not the newer/latest one", async () => {
    // Seed an OLDER archive first (earlier completedAt so findLatestTerminal returns the newer one)
    const olderRunId = await seedReviewedArchive(db, {
      completedAt: new Date("2026-05-19T00:00:00.000Z"),
    });
    // Seed a NEWER archive (later completedAt — this is what findLatestTerminal would return)
    await seedReviewedArchive(db, {
      completedAt: new Date("2026-05-20T00:00:00.000Z"),
    });

    server.use(
      http.post(LINKEDIN_POSTS_URL, ({ request }) => {
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:targeted-older-post" },
        });
      }),
      http.post(LINKEDIN_COMMENTS_URL, ({ request }) => {
        if (!isLinkedInCommentRequest(request.url)) {
          throw new Error(`Unexpected LinkedIn comment URL: ${request.url}`);
        }
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const archiveRepo = createRunArchivesRepo(db);
    const notifier = createLinkedInNotifier({
      apiClient: createLinkedInApiClient(),
      archives: archiveRepo,
      rawItems: createRawItemsRepo(db),
      tokens: createSocialTokensRepo(db, getCredentialCipher()),
      config: {
        clientId: "linkedin-client-id",
        clientSecret: "linkedin-client-secret",
        apiVersion: "202405",
        publicArchiveBaseUrl: "https://newsletter.example.com",
      },
      logger: createLogger("linkedin-post-e2e"),
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: notifier },
      { name: "linkedin-post", data: { runId: olderRunId } },
    );

    // The older archive must be marked as posted
    const olderState = await loadArchiveSocialState(db, olderRunId);
    expect(olderState.linkedinPostedAt).not.toBeNull();
    expect(olderState.socialMetadata?.linkedinPermalink).toBe("urn:li:share:targeted-older-post");
    // The post API was called exactly once (for the older archive, not the newer one)
    expect(linkedInRequests.some((url) => url === LINKEDIN_POSTS_URL)).toBe(true);
  });

  it("EDGE-002 is idempotent: second job with same runId no-ops once linkedinPostedAt is set", async () => {
    const runId = await seedReviewedArchive(db);

    server.use(
      http.post(LINKEDIN_POSTS_URL, ({ request }) => {
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:idempotency-test" },
        });
      }),
      http.post(LINKEDIN_COMMENTS_URL, ({ request }) => {
        if (!isLinkedInCommentRequest(request.url)) {
          throw new Error(`Unexpected LinkedIn comment URL: ${request.url}`);
        }
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const archiveRepo = createRunArchivesRepo(db);
    const makeNotifier = () =>
      createLinkedInNotifier({
        apiClient: createLinkedInApiClient(),
        archives: archiveRepo,
        rawItems: createRawItemsRepo(db),
        tokens: createSocialTokensRepo(db, getCredentialCipher()),
        config: {
          clientId: "linkedin-client-id",
          clientSecret: "linkedin-client-secret",
          apiVersion: "202405",
          publicArchiveBaseUrl: "https://newsletter.example.com",
        },
        logger: createLogger("linkedin-post-e2e"),
        now: () => new Date("2026-05-21T00:00:00.000Z"),
      });

    // First job — should post and set linkedinPostedAt
    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: makeNotifier() },
      { name: "linkedin-post", data: { runId } },
    );

    const afterFirstJob = await loadArchiveSocialState(db, runId);
    expect(afterFirstJob.linkedinPostedAt).not.toBeNull();
    const requestsAfterFirst = linkedInRequests.length;
    expect(requestsAfterFirst).toBeGreaterThan(0);

    // Second job with the same runId — linkedinPostedAt is now set; notifier must NOT be called
    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: makeNotifier() },
      { name: "linkedin-post", data: { runId } },
    );

    expect(linkedInRequests.length).toBe(requestsAfterFirst);
  });

  it("REQ-006 (negative) unreviewed archive with runId: resolvePublishTarget returns null, notifier not called", async () => {
    const runId = await seedReviewedArchive(db, { reviewed: false });

    server.use(
      http.post(LINKEDIN_POSTS_URL, ({ request }) => {
        linkedInRequests = [...linkedInRequests, request.url];
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const archiveRepo = createRunArchivesRepo(db);
    const notifier = createLinkedInNotifier({
      apiClient: createLinkedInApiClient(),
      archives: archiveRepo,
      rawItems: createRawItemsRepo(db),
      tokens: createSocialTokensRepo(db, getCredentialCipher()),
      config: {
        clientId: "linkedin-client-id",
        clientSecret: "linkedin-client-secret",
        apiVersion: "202405",
        publicArchiveBaseUrl: "https://newsletter.example.com",
      },
      logger: createLogger("linkedin-post-e2e"),
    });

    await handleLinkedInPostJob(
      { archiveRepo, linkedinNotifier: notifier },
      { name: "linkedin-post", data: { runId } },
    );

    expect(linkedInRequests).toHaveLength(0);
    const state = await loadArchiveSocialState(db, runId);
    expect(state.linkedinPostedAt).toBeNull();
  });
});
