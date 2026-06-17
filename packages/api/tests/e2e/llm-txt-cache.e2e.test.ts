/**
 * e2e: version-keyed llm.txt content cache against real Postgres + Redis.
 *
 * Validates that:
 *  - the first request renders and writes a cache entry,
 *  - the second request is served from Redis (the cache key exists and the
 *    response matches),
 *  - when the underlying issue changes the version key changes, so a fresh
 *    response is produced rather than a stale cached one,
 *  - the per-issue endpoint caches by runId.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { inArray, sql } from "drizzle-orm";
import { getDb, rawItems, runArchives } from "@newsletter/shared/db";
import { createRedisConnection } from "@newsletter/shared";
import type { RankedItemRef } from "@newsletter/shared";
import {
  createLlmTxtRouter,
  createLlmTxtArchiveRouter,
} from "@api/routes/llm-txt.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import { createRedisLlmTxtCache } from "@api/services/llm-txt-cache.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const redis = createRedisConnection();
const baseUrl = "https://llm-txt-cache-e2e.example.com";
const seedPrefix = `llm-txt-cache-${randomUUID().slice(0, 8)}`;

const seededRunIds = new Set<string>();
const seededRawIds = new Set<number>();
const seededMustReadUrls = new Set<string>();

async function insertRawItem(externalId: string, recapSummary: string): Promise<number> {
  const [row] = await db
    .insert(rawItems)
    .values({
      sourceType: "hn",
      externalId: `${seedPrefix}-${externalId}`,
      title: `Title ${externalId}`,
      url: `https://example.com/${seedPrefix}/${externalId}`,
      author: "llm-txt-e2e",
      publishedAt: new Date("2099-01-01T00:00:00Z"),
      engagement: { points: 5, commentCount: 1 },
      metadata: {
        comments: [],
        recap: {
          title: `Title ${externalId}`,
          summary: recapSummary,
          bullets: ["bullet one"],
          bottomLine: "Bottom line.",
        },
      },
    })
    .returning({ id: rawItems.id });
  seededRawIds.add(row.id);
  return row.id;
}

async function insertArchive(opts: {
  reviewed: boolean;
  isDryRun?: boolean;
  completedAt: Date;
  digestHeadline: string;
  rawItemIds: number[];
}): Promise<string> {
  const runId = randomUUID();
  const rankedItems: RankedItemRef[] = opts.rawItemIds.map((rawItemId, i) => ({
    rawItemId,
    score: 1 - i * 0.1,
    rationale: `r${String(i)}`,
  }));
  await db.insert(runArchives).values({
    id: runId,
    status: "completed",
    rankedItems,
    topN: rankedItems.length,
    reviewed: opts.reviewed,
    isDryRun: opts.isDryRun ?? false,
    completedAt: opts.completedAt,
    publishedAt: opts.completedAt,
    startedAt: new Date(opts.completedAt.getTime() - 60_000),
    sourceTypes: ["hn"],
    digestHeadline: opts.digestHeadline,
    digestSummary: `Summary for ${opts.digestHeadline}`,
  });
  seededRunIds.add(runId);
  return runId;
}

function indexApp(): Hono {
  const app = new Hono();
  app.route(
    "/",
    createLlmTxtRouter({
      getArchiveRepo: () => createRunArchivesRepo(db),
      getRawItemsRepo: () => createRawItemsRepo(db),
      getMustReadRepo: () => createMustReadRepo(db),
      baseUrl,
      cache: createRedisLlmTxtCache(redis),
    }),
  );
  return app;
}

function issueApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/archives",
    createLlmTxtArchiveRouter({
      getArchiveRepo: () => createRunArchivesRepo(db),
      getRawItemsRepo: () => createRawItemsRepo(db),
      getMustReadRepo: () => createMustReadRepo(db),
      baseUrl,
      cache: createRedisLlmTxtCache(redis),
    }),
  );
  return app;
}

async function wipeRedis(): Promise<void> {
  const keys = await redis.keys("llm-txt:*");
  if (keys.length > 0) await redis.del(...keys);
}

async function wipeDb(): Promise<void> {
  if (seededRunIds.size > 0) {
    await db.delete(runArchives).where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededRawIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawIds]));
    seededRawIds.clear();
  }
  for (const url of seededMustReadUrls) {
    await db.execute(sql`DELETE FROM must_read_entries WHERE url = ${url}`);
  }
  seededMustReadUrls.clear();
}

beforeAll(async () => {
  await redis.ping();
  await wipeRedis();
  await wipeDb();
});
afterEach(wipeRedis);
afterAll(async () => {
  await wipeRedis();
  await wipeDb();
  await redis.quit();
});

describe("llm.txt cache (e2e, real Redis + Postgres)", () => {
  it("writes a cache entry on first request and serves the same body on the second", async () => {
    const raw = await insertRawItem("a", "First content.");
    await insertArchive({
      reviewed: true,
      completedAt: new Date("2026-06-17T10:00:00Z"),
      digestHeadline: "Cached headline",
      rawItemIds: [raw],
    });

    const app = indexApp();
    const first = await app.request("/llms.txt");
    const firstBody = await first.text();
    expect(first.status).toBe(200);
    expect(firstBody).toContain("Cached headline");

    const keys = await redis.keys("llm-txt:*");
    expect(keys.length).toBeGreaterThan(0);

    const second = await (await app.request("/llms.txt")).text();
    expect(second).toBe(firstBody);
  });

  it("does not serve stale content after a new issue is published (version key changes)", async () => {
    const rawOld = await insertRawItem("old", "Old content.");
    await insertArchive({
      reviewed: true,
      completedAt: new Date("2026-06-17T10:00:00Z"),
      digestHeadline: "Old issue",
      rawItemIds: [rawOld],
    });

    const app = indexApp();
    const before = await (await app.request("/llms.txt")).text();
    expect(before).toContain("Old issue");
    expect(before).not.toContain("Newer issue");

    const rawNew = await insertRawItem("new", "Newer content.");
    await insertArchive({
      reviewed: true,
      completedAt: new Date("2026-06-18T10:00:00Z"),
      digestHeadline: "Newer issue",
      rawItemIds: [rawNew],
    });

    const after = await (await app.request("/llms.txt")).text();
    expect(after).toContain("Newer issue");
    expect(after).toContain("Old issue");
    expect(after).not.toBe(before);
  });

  it("caches the per-issue endpoint by runId and returns the issue text", async () => {
    const raw = await insertRawItem("issue", "Issue content.");
    const runId = await insertArchive({
      reviewed: true,
      completedAt: new Date("2026-06-17T10:00:00Z"),
      digestHeadline: "Per issue headline",
      rawItemIds: [raw],
    });

    const app = issueApp();
    const first = await app.request(`/api/archives/${runId}/llm.txt`);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Per issue headline");

    const keys = await redis.keys("llm-txt:*");
    expect(keys.some((k) => k.includes(runId))).toBe(true);

    const second = await app.request(`/api/archives/${runId}/llm.txt`);
    expect(second.status).toBe(200);
    expect(await second.text()).toContain("Per issue headline");
  });
});
