/**
 * E2E tests for GET /api/admin/runs/:runId/sources/:sourceKey/items.
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { createRedisConnection } from "@newsletter/shared";
import type { RankedItemRef, RunSourceItemsResponse } from "@newsletter/shared/types";
import { getDb, rawItems, runArchives, runLogs } from "@newsletter/shared/db";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createRunLogRepo } from "@api/repositories/run-logs.js";
import { createAdminRunsRouter } from "@api/routes/admin-runs.js";
import { requireAuth } from "@api/auth/middleware.js";
import { issueToken } from "@api/auth/session.js";
import { ensureE2eTenant } from "./helpers/tenant.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const SESSION_SECRET = "run-source-items-e2e-secret-at-least-32b";

const db = getDb();
const redis = createRedisConnection();
const tenantCtx = await ensureE2eTenant();
const rawItemsRepo = createRawItemsRepo(db, tenantCtx);
const archiveRepo = createRunArchivesRepo(db, tenantCtx);
const runLogRepo = createRunLogRepo(db, tenantCtx);

const seededRunIds = new Set<string>();
const seededRawItemIds = new Set<number>();

const responseSchema = z.object({
  runId: z.string(),
  sourceKey: z.string(),
  live: z.boolean(),
  summary: z.object({
    ranked: z.number(),
    shortlisted: z.number(),
    dedupedSurvivors: z.number(),
    dedupDropped: z.number(),
    enrichFailed: z.number(),
  }),
  items: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      url: z.string().nullable(),
      author: z.string().nullable(),
      engagement: z.object({ points: z.number(), commentCount: z.number() }),
      publishedAt: z.string().nullable(),
      sourceIdentifier: z.string(),
      lifecycle: z.object({
        fetched: z.literal(true),
        enrich: z.object({ status: z.string(), reason: z.string().nullable() }),
        dedup: z
          .object({
            status: z.string(),
            winnerTitle: z.string().nullable(),
            winnerId: z.number().nullable(),
            winnerPoints: z.number().nullable(),
          })
          .nullable(),
        shortlisted: z.boolean().nullable(),
        rank: z.number().nullable(),
      }),
      furthestStage: z.string(),
      dropReason: z.string().nullable(),
    }),
  ),
  logs: z.array(
    z.object({
      id: z.number(),
      runId: z.string(),
      ts: z.string(),
      level: z.string(),
      stage: z.string(),
      source: z.string().nullable(),
      event: z.string(),
      message: z.string(),
      context: z.unknown().nullable(),
    }),
  ),
});

function buildGatedApp(): Hono {
  const app = new Hono();
  app.use("/api/admin/*", requireAuth(SESSION_SECRET));
  app.route(
    "/api/admin/runs",
    createAdminRunsRouter({
      redis,
      getRawItemsRepo: () => rawItemsRepo,
      getArchiveRepo: () => archiveRepo,
      getRunLogRepo: () => runLogRepo,
    }),
  );
  return app;
}

function adminCookie(): string {
  return `admin_session=${issueToken({ userId: "00000000-0000-4000-8000-000000000001", tenantId: null, role: "tenant_admin" }, SESSION_SECRET, Date.now())}`;
}

async function insertRawItem(opts: {
  readonly runId: string | null;
  readonly sourceType: "reddit" | "hn" | "twitter";
  readonly externalId: string;
  readonly title: string;
  readonly url: string;
  readonly points: number;
  readonly commentCount?: number;
  readonly enrichedStatus?: "ok" | "skipped" | "failed";
}): Promise<number> {
  const [row] = await db
    .insert(rawItems)
    .values({
      runId: opts.runId,
      tenantId: tenantCtx.tenantId,
      sourceType: opts.sourceType,
      externalId: `${opts.externalId}-${randomUUID()}`,
      title: opts.title,
      url: opts.url,
      author: "e2e-author",
      publishedAt: new Date("2099-06-01T00:01:00.000Z"),
      collectedAt: new Date("2099-06-01T00:02:00.000Z"),
      engagement: {
        points: opts.points,
        commentCount: opts.commentCount ?? 0,
      },
      metadata: {
        comments: [],
        enrichedLink: {
          url: opts.url,
          fetchedAt: "2099-06-01T00:02:30.000Z",
          status: opts.enrichedStatus ?? "ok",
          markdown: "markdown must not leak",
          failureReason: opts.enrichedStatus === "failed" ? "timeout" : undefined,
          skipReason: opts.enrichedStatus === "skipped" ? "same-platform" : undefined,
        },
      },
    })
    .returning({ id: rawItems.id });
  seededRawItemIds.add(row.id);
  return row.id;
}

async function seedRun(): Promise<{
  readonly runId: string;
  readonly sourceKey: string;
  readonly rankedId: number;
  readonly droppedId: number;
}> {
  const runId = randomUUID();
  const rankedId = await insertRawItem({
    runId,
    sourceType: "reddit",
    externalId: "ranked",
    title: "Ranked Reddit item",
    url: "https://reddit.com/r/AI_Agents/comments/ranked/post",
    points: 20,
  });
  const winnerId = await insertRawItem({
    runId,
    sourceType: "reddit",
    externalId: "winner",
    title: "Dedup winner",
    url: "https://reddit.com/r/AI_Agents/comments/same/post?utm_source=feed",
    points: 30,
  });
  const droppedId = await insertRawItem({
    runId,
    sourceType: "reddit",
    externalId: "dropped",
    title: "Dedup loser",
    url: "https://reddit.com/r/AI_Agents/comments/same/post",
    points: 1,
  });
  await insertRawItem({
    runId,
    sourceType: "hn",
    externalId: "hn",
    title: "Other source item",
    url: "https://news.ycombinator.com/item?id=999",
    points: 5,
  });

  const rankedItems: RankedItemRef[] = [
    { rawItemId: rankedId, score: 0.99, rationale: "top" },
    { rawItemId: winnerId, score: 0.8, rationale: "second" },
  ];

  await db.insert(runArchives).values({
    id: runId,
    tenantId: tenantCtx.tenantId,
    status: "completed",
    rankedItems,
    topN: 5,
    reviewed: false,
    completedAt: new Date("2099-06-01T00:10:00.000Z"),
    startedAt: new Date("2099-06-01T00:00:00.000Z"),
    sourceTypes: ["reddit", "hn"],
    shortlistedItemIds: [rankedId, winnerId],
    runFunnel: { collected: 4, deduped: 3, shortlisted: 3, ranked: 2 },
  });
  seededRunIds.add(runId);

  await db.insert(runLogs).values([
    {
      runId,
      tenantId: tenantCtx.tenantId,
      level: "info",
      stage: "collecting",
      source: "reddit",
      event: "source.completed",
      message: "reddit completed",
      context: { itemsFetched: 3 },
    },
    {
      runId,
      tenantId: tenantCtx.tenantId,
      level: "error",
      stage: "collecting",
      source: "twitter",
      event: "source.failed",
      message: "twitter failed",
      context: { errors: ["auth failed"] },
    },
  ]);

  return {
    runId,
    sourceKey: encodeURIComponent("reddit:r/ai_agents"),
    rankedId,
    droppedId,
  };
}

beforeAll(async () => {
  await redis.ping();
});

afterEach(async () => {
  if (seededRunIds.size > 0) {
    await db.delete(runLogs).where(inArray(runLogs.runId, [...seededRunIds]));
    await db.delete(runArchives).where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededRawItemIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawItemIds]));
    seededRawItemIds.clear();
  }
});

afterAll(async () => {
  await redis.quit();
});

describe("GET /api/admin/runs/:runId/sources/:sourceKey/items", () => {
  it("REQ-003/REQ-004/REQ-009/REQ-014: returns a lean per-source lifecycle payload", async () => {
    const { runId, sourceKey, rankedId, droppedId } = await seedRun();
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/sources/${sourceKey}/items`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    const body: RunSourceItemsResponse = responseSchema.parse(await res.json());
    expect(body.runId).toBe(runId);
    expect(body.sourceKey).toBe("reddit:r/ai_agents");
    expect(body.summary.ranked).toBe(2);
    expect(body.summary.dedupDropped).toBe(1);
    expect(body.items[0]?.id).toBe(rankedId);
    const dropped = body.items.find((item) => item.id === droppedId);
    expect(dropped?.furthestStage).toBe("dedup-dropped");
    expect(dropped?.dropReason).toContain("Dedup winner");
    expect(dropped?.dropReason).toContain("vs");
    expect(body.logs).toHaveLength(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("markdown");
    expect(serialized).not.toContain("recap");
    expect(serialized).not.toContain("cost");
  });

  it("REQ-003: rejects an unauthenticated request with 401", async () => {
    const { runId, sourceKey } = await seedRun();
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/sources/${sourceKey}/items`,
    );
    expect(res.status).toBe(401);
  });

  it("REQ-011: existing run with no matching source returns 200 with empty items and source logs", async () => {
    const { runId } = await seedRun();
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/sources/${encodeURIComponent("twitter:@karpathy")}/items`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    const body = responseSchema.parse(await res.json());
    expect(body.items).toEqual([]);
    expect(body.summary).toEqual({
      ranked: 0,
      shortlisted: 0,
      dedupedSurvivors: 0,
      dedupDropped: 0,
      enrichFailed: 0,
    });
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]?.event).toBe("source.failed");
  });

  it("returns 404 for an unknown runId", async () => {
    const res = await buildGatedApp().request(
      `/api/admin/runs/${randomUUID()}/sources/${encodeURIComponent("reddit:r/ai_agents")}/items`,
      { headers: { cookie: adminCookie() } },
    );
    expect(res.status).toBe(404);
  });
});
