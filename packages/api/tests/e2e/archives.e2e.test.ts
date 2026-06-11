/**
 * Archive route e2e tests for REQ-AR-1..REQ-AR-6.
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createRedisConnection } from "@newsletter/shared";
import {
  emailSends,
  getDb,
  rawItems,
  runArchives,
  subscribers,
  userSettings,
} from "@newsletter/shared/db";
import { AGENTLOOP_TENANT_ID, type RankedItemRef } from "@newsletter/shared";
import type { DigestMeta } from "@newsletter/shared/constants";
import type { GenerateDigestMetaFn } from "@api/services/review.js";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import {
  createAdminArchivesRouter,
  createPublicArchivesRouter,
} from "@api/routes/archives.js";
import { createArchivesSearchRouter } from "@api/routes/archives-search.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const redis = createRedisConnection();
const rawItemsRepo = createRawItemsRepo(db);
const archiveRepo = createRunArchivesRepo(db);

const archiveListResponseSchema = z.object({
  archives: z.array(
    z.object({
      runId: z.uuid(),
      runDate: z.string(),
      storyCount: z.number(),
      topItems: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          sourceType: z.string(),
        }),
      ),
      leadSummary: z.string().nullable(),
      digestHeadline: z.string().nullable(),
      digestSummary: z.string().nullable(),
      isDryRun: z.boolean(),
    }),
  ),
});

const archiveDetailSchema = z.object({
  id: z.uuid(),
  rankedItems: z.array(
    z.object({
      id: z.number(),
      rawItemId: z.number(),
      title: z.string(),
      recap: z
        .object({
          title: z.string(),
          summary: z.string(),
          bullets: z.array(z.string()),
          bottomLine: z.string(),
        })
        .nullable(),
    }),
  ),
  digestHeadline: z.string().nullable(),
  digestSummary: z.string().nullable(),
  completedAt: z.string(),
});

interface SeededArchive {
  readonly runId: string;
  readonly rawItemIds: readonly number[];
}

const seededRunIds = new Set<string>();
const seededRawItemIds = new Set<number>();
const seededSubscriberIds = new Set<string>();
const seededRedisKeys = new Set<string>();
const seedPrefix = `phase1-archives-${String(Date.now())}`;

function buildPublicApp(repo: RunArchivesRepo = archiveRepo): Hono {
  const app = new Hono();
  app.route(
    "/api/archives",
    createPublicArchivesRouter({
      getArchiveRepo: () => repo,
      getRawItemsRepo: () => rawItemsRepo,
    }),
  );
  return app;
}

function buildSearchApp(repo: RunArchivesRepo = archiveRepo): Hono {
  const app = new Hono();
  app.route(
    "/api/archives/search",
    createArchivesSearchRouter({
      getArchiveRepo: () => repo,
      getRawItemsRepo: () => rawItemsRepo,
    }),
  );
  return app;
}

function buildAdminApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/admin/archives",
    createAdminArchivesRouter({
      getArchiveRepo: () => archiveRepo,
      getRawItemsRepo: () => rawItemsRepo,
      redis,
    }),
  );
  return app;
}

async function insertRawItem(opts: {
  readonly externalId: string;
  readonly title: string;
  readonly recapTitle: string;
  readonly recapSummary: string;
}): Promise<number> {
  const [row] = await db
    .insert(rawItems)
    .values({
      tenantId: AGENTLOOP_TENANT_ID,
      sourceType: "hn",
      externalId: `${seedPrefix}-${opts.externalId}`,
      title: opts.title,
      url: `https://example.com/${seedPrefix}/${opts.externalId}`,
      author: "archive-e2e",
      publishedAt: new Date("2099-01-01T00:00:00Z"),
      engagement: { points: 10, commentCount: 2 },
      metadata: {
        comments: [],
        recap: {
          title: opts.recapTitle,
          summary: opts.recapSummary,
          bullets: ["first signal", "second signal"],
          bottomLine: "The archive route should hydrate recap content.",
        },
      },
    })
    .returning({ id: rawItems.id });
  seededRawItemIds.add(row.id);
  return row.id;
}

async function insertArchive(opts: {
  readonly reviewed: boolean;
  readonly completedAt: Date;
  readonly digestHeadline: string;
  readonly digestSummary: string;
  readonly rawItemIds: readonly number[];
  readonly publishedAt?: Date;
  readonly searchText?: string;
  readonly hook?: string | null;
  readonly twitterSummary?: string | null;
  readonly isDryRun?: boolean;
}): Promise<SeededArchive> {
  const runId = randomUUID();
  const rankedItems: RankedItemRef[] = opts.rawItemIds.map((rawItemId, index) => ({
    rawItemId,
    score: 1 - index * 0.1,
    rationale: `ranked item ${String(index + 1)}`,
  }));

  await db.insert(runArchives).values({
    id: runId,
    tenantId: AGENTLOOP_TENANT_ID,
    status: "completed",
    rankedItems,
    topN: rankedItems.length,
    reviewed: opts.reviewed,
    completedAt: opts.completedAt,
    publishedAt: opts.publishedAt ?? null,
    startedAt: new Date(opts.completedAt.getTime() - 60_000),
    sourceTypes: ["hn"],
    digestHeadline: opts.digestHeadline,
    digestSummary: opts.digestSummary,
    hook: opts.hook ?? null,
    twitterSummary: opts.twitterSummary ?? null,
    isDryRun: opts.isDryRun ?? false,
    searchText: opts.searchText ?? null,
  });
  seededRunIds.add(runId);
  return { runId, rawItemIds: opts.rawItemIds };
}

async function cleanupSeeds(): Promise<void> {
  if (seededRunIds.size > 0) {
    await db
      .delete(emailSends)
      .where(inArray(emailSends.runArchiveId, [...seededRunIds]));
    await db
      .delete(runArchives)
      .where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededSubscriberIds.size > 0) {
    await db
      .delete(subscribers)
      .where(inArray(subscribers.id, [...seededSubscriberIds]));
    seededSubscriberIds.clear();
  }
  if (seededRawItemIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawItemIds]));
    seededRawItemIds.clear();
  }
  if (seededRedisKeys.size > 0) {
    await redis.del(...seededRedisKeys);
    seededRedisKeys.clear();
  }
}

async function seedReviewedSet(): Promise<readonly SeededArchive[]> {
  const rawOne = await insertRawItem({
    externalId: "reviewed-one",
    title: "Source title one",
    recapTitle: "Reviewed recap one",
    recapSummary: "Lead summary for the newest archive.",
  });
  const rawTwo = await insertRawItem({
    externalId: "reviewed-two",
    title: "Source title two",
    recapTitle: "Reviewed recap two",
    recapSummary: "Lead summary for the older archive.",
  });
  const newest = await insertArchive({
    reviewed: true,
    completedAt: new Date("2099-02-03T00:00:00Z"),
    digestHeadline: "Newest archive headline",
    digestSummary: "Newest digest summary",
    rawItemIds: [rawOne],
  });
  const older = await insertArchive({
    reviewed: true,
    completedAt: new Date("2099-02-02T00:00:00Z"),
    digestHeadline: "Older archive headline",
    digestSummary: "Older digest summary",
    rawItemIds: [rawTwo],
  });
  return [newest, older];
}

beforeAll(async () => {
  await redis.ping();
});

afterEach(async () => {
  await cleanupSeeds();
});

afterAll(async () => {
  await cleanupSeeds();
  await redis.quit();
});

describe("GET /api/archives (e2e)", () => {
  it("REQ-AR-1: returns reviewed archives sorted by completed_at desc", async () => {
    const [newest, older] = await seedReviewedSet();
    const res = await buildPublicApp().request("/api/archives");

    expect(res.status).toBe(200);
    const body = archiveListResponseSchema.parse(await res.json());
    const seeded = body.archives.filter((archive) =>
      [newest.runId, older.runId].includes(archive.runId),
    );

    expect(seeded).toHaveLength(2);
    expect(seeded.map((archive) => archive.runId)).toEqual([
      newest.runId,
      older.runId,
    ]);
    expect(seeded[0]?.digestHeadline).toBe("Newest archive headline");
    expect(seeded[0]?.storyCount).toBe(1);
    expect(seeded[0]?.topItems[0]?.title).toBe("Reviewed recap one");
  });

  it("REQ-AR-2: excludes unreviewed archives from the public list", async () => {
    const rawId = await insertRawItem({
      externalId: "unreviewed-list",
      title: "Unreviewed list title",
      recapTitle: "Unreviewed recap title",
      recapSummary: "This draft should not be public.",
    });
    const archive = await insertArchive({
      reviewed: false,
      completedAt: new Date("2099-02-01T00:00:00Z"),
      digestHeadline: "Unreviewed list digest",
      digestSummary: "Unreviewed list digest summary",
      rawItemIds: [rawId],
    });

    const res = await buildPublicApp().request("/api/archives");

    expect(res.status).toBe(200);
    const body = archiveListResponseSchema.parse(await res.json());
    expect(
      body.archives.some((item) => item.runId === archive.runId),
    ).toBe(false);
  });
});

describe("GET /api/archives/:runId (e2e)", () => {
  it("REQ-AR-3: returns archive detail for a reviewed archive", async () => {
    const rawId = await insertRawItem({
      externalId: "detail-reviewed",
      title: "Original detail title",
      recapTitle: "Hydrated archive title",
      recapSummary: "Hydrated archive summary.",
    });
    const archive = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-03-01T00:00:00Z"),
      digestHeadline: "Detail digest headline",
      digestSummary: "Detail digest summary",
      rawItemIds: [rawId],
    });

    const res = await buildPublicApp().request(`/api/archives/${archive.runId}`);

    expect(res.status).toBe(200);
    const body = archiveDetailSchema.parse(await res.json());
    expect(body.id).toBe(archive.runId);
    expect(body.rankedItems).toHaveLength(1);
    expect(body.rankedItems[0]?.title).toBe("Hydrated archive title");
    expect(body.digestHeadline).toBe("Detail digest headline");
    expect(body.digestSummary).toBe("Detail digest summary");
    expect(body.completedAt).toBe("2099-03-01T00:00:00.000Z");
  });

  it("REQ-AR-4: returns 404 for a missing archive", async () => {
    const res = await buildPublicApp().request(`/api/archives/${randomUUID()}`);

    expect(res.status).toBe(404);
  });

  it("REQ-AR-4: returns 404 for an unreviewed archive", async () => {
    const rawId = await insertRawItem({
      externalId: "detail-unreviewed",
      title: "Unreviewed title",
      recapTitle: "Unreviewed recap title",
      recapSummary: "Should not be public.",
    });
    const archive = await insertArchive({
      reviewed: false,
      completedAt: new Date("2099-03-02T00:00:00Z"),
      digestHeadline: "Unreviewed digest",
      digestSummary: "Unreviewed digest summary",
      rawItemIds: [rawId],
    });

    const res = await buildPublicApp().request(`/api/archives/${archive.runId}`);

    expect(res.status).toBe(404);
  });
});

describe("publish-aware date + ordering (e2e)", () => {
  it("REQ-006: GET /api/archives runDate uses published_at when set (distinct from completed_at)", async () => {
    const rawId = await insertRawItem({
      externalId: "pub-list-set",
      title: "Publish list title",
      recapTitle: "Publish list recap",
      recapSummary: "Publish list summary.",
    });
    const archive = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-05-25T12:00:00Z"),
      publishedAt: new Date("2099-05-26T12:00:00Z"),
      digestHeadline: "Publish list headline",
      digestSummary: "Publish list digest summary",
      rawItemIds: [rawId],
    });

    const res = await buildPublicApp().request("/api/archives");
    expect(res.status).toBe(200);
    const body = archiveListResponseSchema.parse(await res.json());
    const row = body.archives.find((a) => a.runId === archive.runId);
    expect(row).toBeDefined();
    expect(row?.runDate).toBe("2099-05-26");
  });

  it("REQ-007: GET /api/archives/:runId issueDate uses published_at when set", async () => {
    const rawId = await insertRawItem({
      externalId: "pub-detail-set",
      title: "Publish detail title",
      recapTitle: "Publish detail recap",
      recapSummary: "Publish detail summary.",
    });
    const archive = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-05-25T12:00:00Z"),
      publishedAt: new Date("2099-05-26T12:00:00Z"),
      digestHeadline: "Publish detail headline",
      digestSummary: "Publish detail digest summary",
      rawItemIds: [rawId],
    });

    const res = await buildPublicApp().request(`/api/archives/${archive.runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issueDate?: string };
    expect(body.issueDate).toBe("2099-05-26");
  });

  it("EDGE-003: NULL published_at falls back to completed_at (list) / startedAt (detail)", async () => {
    const rawId = await insertRawItem({
      externalId: "pub-null-fallback",
      title: "Null fallback title",
      recapTitle: "Null fallback recap",
      recapSummary: "Null fallback summary.",
    });
    const archive = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-04-10T12:00:00Z"),
      digestHeadline: "Null fallback headline",
      digestSummary: "Null fallback digest summary",
      rawItemIds: [rawId],
    });

    const listRes = await buildPublicApp().request("/api/archives");
    const listBody = archiveListResponseSchema.parse(await listRes.json());
    const listRow = listBody.archives.find((a) => a.runId === archive.runId);
    expect(listRow?.runDate).toBe("2099-04-10");

    const detailRes = await buildPublicApp().request(
      `/api/archives/${archive.runId}`,
    );
    const detailBody = (await detailRes.json()) as { issueDate?: string };
    // startedAt = completedAt - 60s, still the same UTC day at noon.
    expect(detailBody.issueDate).toBe("2099-04-10");
  });

  it("REQ-008/EDGE-005: listing orders by coalesce(published_at, completed_at) desc", async () => {
    const rawX = await insertRawItem({
      externalId: "order-x",
      title: "Order X title",
      recapTitle: "Order X recap",
      recapSummary: "Order X summary.",
    });
    const rawY = await insertRawItem({
      externalId: "order-y",
      title: "Order Y title",
      recapTitle: "Order Y recap",
      recapSummary: "Order Y summary.",
    });
    // X: published_at = 2099-05-26 (later effective), but completed_at = 2099-03-01
    //    (older than Y's completed_at). Under completed_at-only ordering X loses;
    //    under coalesce(published_at, completed_at) X wins.
    const x = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-03-01T12:00:00Z"),
      publishedAt: new Date("2099-05-26T12:00:00Z"),
      digestHeadline: "Order X headline",
      digestSummary: "Order X digest summary",
      rawItemIds: [rawX],
    });
    // Y: published_at NULL, completed_at = 2099-05-01 (effective 05-01 < 05-26).
    const y = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-05-01T12:00:00Z"),
      digestHeadline: "Order Y headline",
      digestSummary: "Order Y digest summary",
      rawItemIds: [rawY],
    });

    const res = await buildPublicApp().request("/api/archives");
    const body = archiveListResponseSchema.parse(await res.json());
    const seeded = body.archives
      .filter((a) => [x.runId, y.runId].includes(a.runId))
      .map((a) => a.runId);
    expect(seeded).toEqual([x.runId, y.runId]);
  });

  it("REQ-008: search with no q orders by coalesce(published_at, completed_at) desc", async () => {
    const rawX = await insertRawItem({
      externalId: "search-noq-x",
      title: "Search noq X title",
      recapTitle: "Search noq X recap",
      recapSummary: "Search noq X summary.",
    });
    const rawY = await insertRawItem({
      externalId: "search-noq-y",
      title: "Search noq Y title",
      recapTitle: "Search noq Y recap",
      recapSummary: "Search noq Y summary.",
    });
    // X effective 05-26 but completed_at 03-01; Y effective 05-01 (NULL pub).
    const x = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-03-01T12:00:00Z"),
      publishedAt: new Date("2099-05-26T12:00:00Z"),
      digestHeadline: "Search noq X headline",
      digestSummary: "Search noq X digest summary",
      rawItemIds: [rawX],
    });
    const y = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-05-01T12:00:00Z"),
      digestHeadline: "Search noq Y headline",
      digestSummary: "Search noq Y digest summary",
      rawItemIds: [rawY],
    });

    const res = await buildSearchApp().request("/api/archives/search");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      archives: { runId: string }[];
    };
    const seeded = body.archives
      .filter((a) => [x.runId, y.runId].includes(a.runId))
      .map((a) => a.runId);
    expect(seeded).toEqual([x.runId, y.runId]);
  });

  it("REQ-008: search with q ranks first then coalesce tiebreak (no throw)", async () => {
    const term = `zylpwq${String(Date.now())}`;
    const rawX = await insertRawItem({
      externalId: "search-q-x",
      title: "Search q X title",
      recapTitle: "Search q X recap",
      recapSummary: "Search q X summary.",
    });
    const rawY = await insertRawItem({
      externalId: "search-q-y",
      title: "Search q Y title",
      recapTitle: "Search q Y recap",
      recapSummary: "Search q Y summary.",
    });
    // Both rows share the same search term so rank ties; the coalesce tiebreak
    // must put the later effective date first. X effective 05-26 (completed 03-01),
    // Y effective 05-01 (NULL pub) — disagrees with a completed_at-only tiebreak.
    const x = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-03-01T12:00:00Z"),
      publishedAt: new Date("2099-05-26T12:00:00Z"),
      digestHeadline: "Search q X headline",
      digestSummary: "Search q X digest summary",
      rawItemIds: [rawX],
      searchText: term,
    });
    const y = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-05-01T12:00:00Z"),
      digestHeadline: "Search q Y headline",
      digestSummary: "Search q Y digest summary",
      rawItemIds: [rawY],
      searchText: term,
    });

    const res = await buildSearchApp().request(
      `/api/archives/search?q=${term}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      archives: { runId: string }[];
    };
    const seeded = body.archives
      .filter((a) => [x.runId, y.runId].includes(a.runId))
      .map((a) => a.runId);
    expect(seeded).toEqual([x.runId, y.runId]);
  });

  it("REQ-007: single-archive response does not expose a raw publishedAt field", async () => {
    const rawId = await insertRawItem({
      externalId: "pub-no-leak",
      title: "No leak title",
      recapTitle: "No leak recap",
      recapSummary: "No leak summary.",
    });
    const archive = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-05-25T12:00:00Z"),
      publishedAt: new Date("2099-05-26T12:00:00Z"),
      digestHeadline: "No leak headline",
      digestSummary: "No leak digest summary",
      rawItemIds: [rawId],
    });

    const res = await buildPublicApp().request(`/api/archives/${archive.runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "publishedAt")).toBe(false);
  });
});

describe("DELETE /api/admin/archives/:runId (e2e)", () => {
  it("REQ-AR-5: deletes the archive, email_sends rows, and Redis run key", async () => {
    const rawId = await insertRawItem({
      externalId: "delete-reviewed",
      title: "Delete title",
      recapTitle: "Delete recap title",
      recapSummary: "Delete recap summary.",
    });
    const archive = await insertArchive({
      reviewed: true,
      completedAt: new Date("2099-04-01T00:00:00Z"),
      digestHeadline: "Delete digest",
      digestSummary: "Delete digest summary",
      rawItemIds: [rawId],
    });
    const [subscriber] = await db
      .insert(subscribers)
      .values({
        tenantId: AGENTLOOP_TENANT_ID,
        email: `${archive.runId}@example.com`,
        status: "confirmed",
      })
      .returning({ id: subscribers.id });
    seededSubscriberIds.add(subscriber.id);
    await db.insert(emailSends).values({
      tenantId: AGENTLOOP_TENANT_ID,
      subscriberId: subscriber.id,
      runArchiveId: archive.runId,
      messageId: `msg-${archive.runId}`,
    });
    const redisKey = `run:${archive.runId}`;
    await redis.set(redisKey, "stale-run-state");
    seededRedisKeys.add(redisKey);

    const res = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(204);
    const archiveRows = await db
      .select({ id: runArchives.id })
      .from(runArchives)
      .where(eq(runArchives.id, archive.runId));
    const emailRows = await db
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(eq(emailSends.runArchiveId, archive.runId));
    expect(archiveRows).toEqual([]);
    expect(emailRows).toEqual([]);
    expect(await redis.exists(redisKey)).toBe(0);
    seededRunIds.delete(archive.runId);
    seededRedisKeys.delete(redisKey);
  });

  it("REQ-AR-6: returns 404 for a valid missing runId", async () => {
    const res = await buildAdminApp().request(
      `/api/admin/archives/${randomUUID()}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(404);
  });
});

// ── immediate-publish e2e (Phase 2) ──────────────────────────────────────────

const settingsRepo = createUserSettingsRepo(db);

/**
 * Seed a singleton user_settings row with all three publish channels enabled
 * and their times set in the past relative to the given completedAt.
 * Pipeline time is "06:00 UTC"; channel times "07:00", "08:00", "09:00".
 * After completedAt=06:00 UTC, reviewing at "now" > 09:00 makes all past-due.
 */
async function seedSettings(): Promise<void> {
  // upsert — handles both fresh and already-existing singleton
  await settingsRepo.upsert({
    topN: 10,
    shortlistSize: 20,
    halfLifeHours: 24,
    hnEnabled: false,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    pipelineTime: "06:00",
    emailTime: "07:00",
    linkedinTime: "08:00",
    twitterTime: "09:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "rank these items",
    shortlistPrompt: "shortlist these items",
  });
}

async function cleanupSettings(): Promise<void> {
  // Reset singleton to a no-op state so other e2e tests aren't affected
  await db.delete(userSettings);
}

describe("PATCH /api/admin/archives/:runId — immediate publish (e2e)", () => {
  afterEach(async () => {
    await cleanupSettings();
    await cleanupSeeds();
    vi.useRealTimers();
  });

  it(
    "VS-1 / EDGE-006: late review triggers immediate enqueue for all past-due enabled channels",
    async () => {
      // Seed: archive completedAt 06:00 UTC, channels 07:00/08:00/09:00 past-due
      // because "now" is the next day.
      const completedAt = new Date("2026-01-15T06:00:00Z");
      // "now" is midnight next day so all channel moments are past-due
      const nowPastDue = new Date("2026-01-16T00:00:00Z");
      vi.setSystemTime(nowPastDue);

      await seedSettings();

      const rawId = await insertRawItem({
        externalId: "imm-vs1",
        title: "Immediate VS1 title",
        recapTitle: "Immediate VS1 recap",
        recapSummary: "Immediate VS1 summary.",
      });
      const archive = await insertArchive({
        reviewed: false, // unreviewed → PATCH will mark it reviewed
        completedAt,
        digestHeadline: "Immediate VS1 digest",
        digestSummary: "Immediate VS1 digest summary",
        rawItemIds: [rawId],
      });

      // Use a spy queue to capture enqueue calls without real Redis queue
      const addSpy = vi.fn(() => Promise.resolve({ id: "spy-job" }));
      const spyQueue = { add: addSpy };

      const app = new Hono();
      app.route(
        "/api/admin/archives",
        createAdminArchivesRouter({
          getArchiveRepo: () => archiveRepo,
          getRawItemsRepo: () => rawItemsRepo,
          getSettingsRepo: () => settingsRepo,
          processingQueue: spyQueue,
          redis,
        }),
      );

      const res = await app.request(`/api/admin/archives/${archive.runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [{ id: rawId, sourceType: "hn" }],
        }),
      });

      expect(res.status).toBe(200);

      // All three channels should be enqueued
      expect(addSpy).toHaveBeenCalledTimes(3);
      expect(addSpy).toHaveBeenCalledWith(
        "email-send",
        { runId: archive.runId },
        { jobId: `email-send-${archive.runId}`, delay: 0 },
      );
      expect(addSpy).toHaveBeenCalledWith(
        "linkedin-post",
        { runId: archive.runId },
        { jobId: `linkedin-post-${archive.runId}`, delay: 0 },
      );
      expect(addSpy).toHaveBeenCalledWith(
        "twitter-post",
        { runId: archive.runId },
        { jobId: `twitter-post-${archive.runId}`, delay: 0 },
      );
    },
  );

  it(
    "VS-2 / REQ-011 / EDGE-004: channel already marked sent → PATCH does NOT re-enqueue that channel",
    async () => {
      const completedAt = new Date("2026-01-15T06:00:00Z");
      const nowPastDue = new Date("2026-01-16T00:00:00Z");
      vi.setSystemTime(nowPastDue);

      await seedSettings();

      const rawId = await insertRawItem({
        externalId: "imm-vs2",
        title: "Immediate VS2 title",
        recapTitle: "Immediate VS2 recap",
        recapSummary: "Immediate VS2 summary.",
      });
      const archive = await insertArchive({
        reviewed: false,
        completedAt,
        digestHeadline: "Immediate VS2 digest",
        digestSummary: "Immediate VS2 digest summary",
        rawItemIds: [rawId],
      });

      // Mark emailSentAt as already sent in the DB
      await db
        .update(runArchives)
        .set({ emailSentAt: new Date("2026-01-15T07:05:00Z") })
        .where(eq(runArchives.id, archive.runId));

      const addSpy = vi.fn(() => Promise.resolve({ id: "spy-job" }));
      const spyQueue = { add: addSpy };

      const app = new Hono();
      app.route(
        "/api/admin/archives",
        createAdminArchivesRouter({
          getArchiveRepo: () => archiveRepo,
          getRawItemsRepo: () => rawItemsRepo,
          getSettingsRepo: () => settingsRepo,
          processingQueue: spyQueue,
          redis,
        }),
      );

      const res = await app.request(`/api/admin/archives/${archive.runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [{ id: rawId, sourceType: "hn" }],
        }),
      });

      expect(res.status).toBe(200);

      // email-send must NOT be re-enqueued (already sent); linkedin and twitter still enqueued
      expect(addSpy).not.toHaveBeenCalledWith(
        "email-send",
        expect.anything(),
        expect.anything(),
      );
      expect(addSpy).toHaveBeenCalledWith(
        "linkedin-post",
        { runId: archive.runId },
        { jobId: `linkedin-post-${archive.runId}`, delay: 0 },
      );
      expect(addSpy).toHaveBeenCalledWith(
        "twitter-post",
        { runId: archive.runId },
        { jobId: `twitter-post-${archive.runId}`, delay: 0 },
      );
    },
  );
});

describe("POST /api/admin/archives/:runId/regenerate-digest-meta (e2e)", () => {
  const sampleMeta: DigestMeta = {
    headline: "Regenerated headline",
    summary: "Regenerated summary",
    hook: "Regenerated hook",
    twitterSummary: "Regenerated twitter summary",
  };

  function buildAdminAppWith(generateDigestMeta: GenerateDigestMetaFn): Hono {
    const app = new Hono();
    app.route(
      "/api/admin/archives",
      createAdminArchivesRouter({
        getArchiveRepo: () => archiveRepo,
        getRawItemsRepo: () => rawItemsRepo,
        generateDigestMeta,
      }),
    );
    return app;
  }

  async function seedReviewable(): Promise<SeededArchive> {
    const rawId = await insertRawItem({
      externalId: "regen-one",
      title: "Regen source title",
      recapTitle: "Regen recap title",
      recapSummary: "Regen recap summary",
    });
    return insertArchive({
      reviewed: true,
      completedAt: new Date("2099-03-01T00:00:00Z"),
      digestHeadline: "Original headline",
      digestSummary: "Original summary",
      rawItemIds: [rawId],
    });
  }

  it("REQ-005: returns 200 with the regenerated blob and does NOT persist", async () => {
    const archive = await seedReviewable();
    const generateDigestMeta = vi.fn(() => Promise.resolve(sampleMeta));
    const app = buildAdminAppWith(generateDigestMeta);

    const res = await app.request(
      `/api/admin/archives/${archive.runId}/regenerate-digest-meta`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: archive.rawItemIds[0],
              title: "Item title",
              summary: "Item summary",
              bottomLine: "Item bottom line",
            },
          ],
        }),
      },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as DigestMeta;
    expect(json).toEqual(sampleMeta);

    // No persistence: the DB row's digest columns are unchanged
    const [row] = await db
      .select({
        digestHeadline: runArchives.digestHeadline,
        digestSummary: runArchives.digestSummary,
        hook: runArchives.hook,
        twitterSummary: runArchives.twitterSummary,
      })
      .from(runArchives)
      .where(eq(runArchives.id, archive.runId));
    expect(row.digestHeadline).toBe("Original headline");
    expect(row.digestSummary).toBe("Original summary");
    expect(row.hook).toBeNull();
    expect(row.twitterSummary).toBeNull();
  });

  it("REQ-006: returns 404 for a non-existent run", async () => {
    const generateDigestMeta = vi.fn(() => Promise.resolve(sampleMeta));
    const app = buildAdminAppWith(generateDigestMeta);

    const res = await app.request(
      `/api/admin/archives/${randomUUID()}/regenerate-digest-meta`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id: 1, title: "t", summary: "s", bottomLine: "b" }],
        }),
      },
    );

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(typeof json.error).toBe("string");
    expect(generateDigestMeta).not.toHaveBeenCalled();
  });

  it("REQ-008: returns 502 with an error when the digest call rejects", async () => {
    const archive = await seedReviewable();
    const generateDigestMeta = vi.fn(() =>
      Promise.reject(new Error("llm boom")),
    );
    const app = buildAdminAppWith(generateDigestMeta);

    const res = await app.request(
      `/api/admin/archives/${archive.runId}/regenerate-digest-meta`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: archive.rawItemIds[0],
              title: "t",
              summary: "s",
              bottomLine: "b",
            },
          ],
        }),
      },
    );

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("llm boom");
  });
});

describe("PATCH /api/admin/archives/:runId — digest meta persistence (e2e)", () => {
  function buildPatchApp(): Hono {
    const app = new Hono();
    app.route(
      "/api/admin/archives",
      createAdminArchivesRouter({
        getArchiveRepo: () => archiveRepo,
        getRawItemsRepo: () => rawItemsRepo,
        redis,
      }),
    );
    return app;
  }

  async function readDigestColumns(runId: string): Promise<{
    digestHeadline: string | null;
    digestSummary: string | null;
    hook: string | null;
    twitterSummary: string | null;
    searchText: string | null;
  }> {
    const [row] = await db
      .select({
        digestHeadline: runArchives.digestHeadline,
        digestSummary: runArchives.digestSummary,
        hook: runArchives.hook,
        twitterSummary: runArchives.twitterSummary,
        searchText: runArchives.searchText,
      })
      .from(runArchives)
      .where(eq(runArchives.id, runId));
    return row;
  }

  async function seedPatchable(opts: {
    hook?: string | null;
    twitterSummary?: string | null;
  } = {}): Promise<SeededArchive> {
    const rawId = await insertRawItem({
      externalId: `patch-${randomUUID()}`,
      title: "Patch source title",
      recapTitle: "Patch recap title",
      recapSummary: "Patch recap summary",
    });
    return insertArchive({
      reviewed: false,
      completedAt: new Date("2099-03-01T00:00:00Z"),
      digestHeadline: "Original headline",
      digestSummary: "Original summary",
      hook: opts.hook ?? null,
      twitterSummary: opts.twitterSummary ?? null,
      rawItemIds: [rawId],
    });
  }

  async function patch(runId: string, body: Record<string, unknown>): Promise<Response> {
    return buildPatchApp().request(`/api/admin/archives/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("REQ-010: persists all four digest fields and recomputes searchText from the new headline/summary", async () => {
    const archive = await seedPatchable();
    const res = await patch(archive.runId, {
      rankedItems: [{ id: archive.rawItemIds[0], sourceType: "hn" }],
      digestHeadline: "Brand new headline copy",
      digestSummary: "Brand new summary copy",
      hook: "Brand new hook",
      twitterSummary: "Brand new tweet",
    });
    expect(res.status).toBe(200);

    const row = await readDigestColumns(archive.runId);
    expect(row.digestHeadline).toBe("Brand new headline copy");
    expect(row.digestSummary).toBe("Brand new summary copy");
    expect(row.hook).toBe("Brand new hook");
    expect(row.twitterSummary).toBe("Brand new tweet");
    // searchText reflects the NEW headline + summary copy (FTS index in sync)
    expect(row.searchText).toContain("Brand new headline copy");
    expect(row.searchText).toContain("Brand new summary copy");
  });

  it("REQ-011: PATCH with only rankedItems preserves existing digest columns (not nulled)", async () => {
    const archive = await seedPatchable({
      hook: "Existing hook",
      twitterSummary: "Existing tweet",
    });
    const res = await patch(archive.runId, {
      rankedItems: [{ id: archive.rawItemIds[0], sourceType: "hn" }],
    });
    expect(res.status).toBe(200);

    const row = await readDigestColumns(archive.runId);
    expect(row.digestHeadline).toBe("Original headline");
    expect(row.digestSummary).toBe("Original summary");
    expect(row.hook).toBe("Existing hook");
    expect(row.twitterSummary).toBe("Existing tweet");
  });

  it("EDGE-004: PATCH with hook:'' writes an empty string", async () => {
    const archive = await seedPatchable({ hook: "Existing hook" });
    const res = await patch(archive.runId, {
      rankedItems: [{ id: archive.rawItemIds[0], sourceType: "hn" }],
      hook: "",
    });
    expect(res.status).toBe(200);

    const row = await readDigestColumns(archive.runId);
    expect(row.hook).toBe("");
  });

  it("EDGE-009: PATCH with digestHeadline:null writes null and recomputes searchText without the headline", async () => {
    const archive = await seedPatchable();
    const res = await patch(archive.runId, {
      rankedItems: [{ id: archive.rawItemIds[0], sourceType: "hn" }],
      digestHeadline: null,
    });
    expect(res.status).toBe(200);

    const row = await readDigestColumns(archive.runId);
    expect(row.digestHeadline).toBeNull();
    // summary preserved (omitted); searchText no longer carries the old headline
    expect(row.digestSummary).toBe("Original summary");
    expect(row.searchText).not.toContain("Original headline");
    expect(row.searchText).toContain("Original summary");
  });

  it("searchText changes when the headline is regenerated", async () => {
    const archive = await seedPatchable();

    const first = await patch(archive.runId, {
      rankedItems: [{ id: archive.rawItemIds[0], sourceType: "hn" }],
      digestHeadline: "First saved headline",
      digestSummary: "First saved summary",
    });
    expect(first.status).toBe(200);
    const before = (await readDigestColumns(archive.runId)).searchText;

    const second = await patch(archive.runId, {
      rankedItems: [{ id: archive.rawItemIds[0], sourceType: "hn" }],
      digestHeadline: "Regenerated headline copy",
      digestSummary: "Regenerated summary copy",
    });
    expect(second.status).toBe(200);
    const after = (await readDigestColumns(archive.runId)).searchText;

    expect(after).not.toBe(before);
    expect(after).toContain("Regenerated headline copy");
    expect(before).toContain("First saved headline");
  });
});

describe("admin vs public archive detail — twitterSummary exposure (e2e)", () => {
  async function seedReviewedWithTwitter(): Promise<SeededArchive> {
    const rawId = await insertRawItem({
      externalId: `tw-expose-${randomUUID()}`,
      title: "Twitter expose source",
      recapTitle: "Twitter expose recap",
      recapSummary: "Twitter expose summary",
    });
    return insertArchive({
      reviewed: true,
      completedAt: new Date("2099-03-05T00:00:00Z"),
      digestHeadline: "Expose headline",
      digestSummary: "Expose summary",
      hook: "Expose hook",
      twitterSummary: "Expose tweet body",
      rawItemIds: [rawId],
    });
  }

  it("REQ-013: admin GET detail returns twitterSummary", async () => {
    const archive = await seedReviewedWithTwitter();
    const app = new Hono();
    app.route(
      "/api/admin/archives",
      createAdminArchivesRouter({
        getArchiveRepo: () => archiveRepo,
        getRawItemsRepo: () => rawItemsRepo,
        redis,
      }),
    );
    const res = await app.request(`/api/admin/archives/${archive.runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.twitterSummary).toBe("Expose tweet body");
  });

  it("REQ-014: public GET detail has NO twitterSummary key", async () => {
    const archive = await seedReviewedWithTwitter();
    const res = await buildPublicApp().request(`/api/archives/${archive.runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "twitterSummary")).toBe(false);
  });
});
