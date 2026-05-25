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
    publishedAt: opts.publishedAt ?? null,
    startedAt: new Date(opts.completedAt.getTime() - 60_000),
    sourceTypes: ["hn"],
    digestHeadline: opts.digestHeadline,
    digestSummary: opts.digestSummary,
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
