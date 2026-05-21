/**
 * Archive route e2e tests for REQ-AR-1..REQ-AR-6.
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
} from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createAdminArchivesRouter,
  createPublicArchivesRouter,
} from "@api/routes/archives.js";

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
}): Promise<SeededArchive> {
  const runId = randomUUID();
  const rankedItems: RankedItemRef[] = opts.rawItemIds.map((rawItemId, index) => ({
    rawItemId,
    score: 1 - index * 0.1,
    rationale: `ranked item ${String(index + 1)}`,
  }));

  await db.insert(runArchives).values({
    id: runId,
    status: "completed",
    rankedItems,
    topN: rankedItems.length,
    reviewed: opts.reviewed,
    completedAt: opts.completedAt,
    startedAt: new Date(opts.completedAt.getTime() - 60_000),
    sourceTypes: ["hn"],
    digestHeadline: opts.digestHeadline,
    digestSummary: opts.digestSummary,
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
        email: `${archive.runId}@example.com`,
        status: "confirmed",
      })
      .returning({ id: subscribers.id });
    seededSubscriberIds.add(subscriber.id);
    await db.insert(emailSends).values({
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
