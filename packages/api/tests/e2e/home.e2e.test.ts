/**
 * Phase 3 e2e: public GET /api/home composite endpoint.
 * Covers REQ-004, REQ-010, NF-003, EDGE-001, EDGE-002, EDGE-011, EDGE-013.
 *
 * The shared e2e DB may contain pre-existing reviewed archives. To stay
 * deterministic, each test temporarily flips all other reviewed archives to
 * reviewed=false for the duration of the test, then restores them in cleanup.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import {
  getDb,
  rawItems,
  runArchives,
} from "@newsletter/shared/db";
import type {
  ArchiveListItem,
  HomePagePayload,
  PublicMustReadEntry,
  RankedItemRef,
} from "@newsletter/shared";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import { createPublicHomeRouter } from "@api/routes/home.js";
import { ensureE2eTenant } from "./helpers/tenant.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const tenantCtx = await ensureE2eTenant();
const rawItemsRepo = createRawItemsRepo(db, tenantCtx);
const archiveRepo = createRunArchivesRepo(db, tenantCtx);
const mustReadRepo = createMustReadRepo(db, tenantCtx);

const MUST_READ_PREFIX = "https://home-e2e-must-read.example.com/";
const RAW_PREFIX = `home-e2e-${String(Date.now())}`;

const seededRunIds = new Set<string>();
const seededRawItemIds = new Set<number>();
let hiddenRunIds: string[] = [];

function buildApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/home",
    createPublicHomeRouter({
      getArchiveRepo: () => archiveRepo,
      getRawItemsRepo: () => rawItemsRepo,
      getMustReadRepo: () => mustReadRepo,
    }),
  );
  return app;
}

async function hideOtherReviewed(): Promise<void> {
  // Snapshot every reviewed archive id NOT in our seeded set, then flip them
  // to reviewed=false for the duration of the test. They're restored in
  // afterEach.
  const rows = await db
    .select({ id: runArchives.id })
    .from(runArchives)
    .where(eq(runArchives.reviewed, true));
  hiddenRunIds = rows
    .map((r) => r.id)
    .filter((id) => !seededRunIds.has(id));
  if (hiddenRunIds.length > 0) {
    await db
      .update(runArchives)
      .set({ reviewed: false })
      .where(inArray(runArchives.id, hiddenRunIds));
  }
}

async function restoreHidden(): Promise<void> {
  if (hiddenRunIds.length > 0) {
    await db
      .update(runArchives)
      .set({ reviewed: true })
      .where(inArray(runArchives.id, hiddenRunIds));
    hiddenRunIds = [];
  }
}

async function wipeMustRead(): Promise<void> {
  await db.execute(
    sql`DELETE FROM must_read_entries WHERE url LIKE ${MUST_READ_PREFIX + "%"}`,
  );
}

async function cleanup(): Promise<void> {
  await restoreHidden();
  if (seededRunIds.size > 0) {
    await db.delete(runArchives).where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededRawItemIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawItemIds]));
    seededRawItemIds.clear();
  }
  await wipeMustRead();
}

beforeAll(cleanup);
afterAll(cleanup);
beforeEach(cleanup);
afterEach(cleanup);

async function insertRawItem(opts: {
  externalId: string;
  title: string;
  recapTitle: string;
  recapSummary: string;
}): Promise<number> {
  const [row] = await db
    .insert(rawItems)
    .values({
      tenantId: tenantCtx.tenantId,
      sourceType: "hn",
      externalId: `${RAW_PREFIX}-${opts.externalId}`,
      title: opts.title,
      url: `https://example.com/${RAW_PREFIX}/${opts.externalId}`,
      author: "home-e2e",
      publishedAt: new Date("2099-01-01T00:00:00Z"),
      engagement: { points: 5, commentCount: 1 },
      metadata: {
        comments: [],
        recap: {
          title: opts.recapTitle,
          summary: opts.recapSummary,
          bullets: ["b1"],
          bottomLine: "bl",
        },
      },
    })
    .returning({ id: rawItems.id });
  seededRawItemIds.add(row.id);
  return row.id;
}

async function insertArchive(opts: {
  reviewed: boolean;
  completedAt: Date;
  digestHeadline: string;
  digestSummary: string;
  rawItemIds: readonly number[];
}): Promise<string> {
  const runId = randomUUID();
  const rankedItems: RankedItemRef[] = opts.rawItemIds.map((rawItemId, i) => ({
    rawItemId,
    score: 1 - i * 0.1,
    rationale: `r${String(i)}`,
  }));
  await db.insert(runArchives).values({
    id: runId,
    tenantId: tenantCtx.tenantId,
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
  return runId;
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

describe("GET /api/home (e2e)", () => {
  it("REQ-010 / EDGE-001 / EDGE-002: no archives + no must-read → null/null/[]", async () => {
    await hideOtherReviewed();
    const res = await buildApp().request("/api/home");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomePagePayload;
    expect(body.todaysIssue).toBeNull();
    expect(body.featuredCanon).toBeNull();
    expect(body.recentIssues).toEqual([]);
  });

  it("REQ-010 + EDGE-011: archive completed 30h ago is today's issue", async () => {
    const rawId = await insertRawItem({
      externalId: "today-fresh",
      title: "Fresh source",
      recapTitle: "Fresh recap",
      recapSummary: "Today's lead summary",
    });
    const runId = await insertArchive({
      reviewed: true,
      completedAt: hoursAgo(30),
      digestHeadline: "Fresh digest",
      digestSummary: "Fresh digest summary",
      rawItemIds: [rawId],
    });
    await hideOtherReviewed();

    const res = await buildApp().request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.todaysIssue).not.toBeNull();
    expect(body.todaysIssue?.runId).toBe(runId);
    expect(body.recentIssues.some((a) => a.runId === runId)).toBe(false);
  });

  it("REQ-010 + EDGE-011: archive completed 49h ago is NOT today's issue but appears in recentIssues", async () => {
    const rawId = await insertRawItem({
      externalId: "today-stale",
      title: "Stale source",
      recapTitle: "Stale recap",
      recapSummary: "Older summary",
    });
    const runId = await insertArchive({
      reviewed: true,
      completedAt: hoursAgo(49),
      digestHeadline: "Stale digest",
      digestSummary: "Stale digest summary",
      rawItemIds: [rawId],
    });
    await hideOtherReviewed();

    const res = await buildApp().request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.todaysIssue).toBeNull();
    const matchedRecent = body.recentIssues.filter((a) => a.runId === runId);
    expect(matchedRecent.length).toBe(1);
    expect(matchedRecent[0]?.digestHeadline).toBe("Stale digest");
  });

  it("REQ-010 (exclusion + limit): with today's issue, recentIssues excludes that id and is ≤10", async () => {
    const todayRawId = await insertRawItem({
      externalId: "today-base",
      title: "Today base",
      recapTitle: "Today recap",
      recapSummary: "today summary",
    });
    const todayRunId = await insertArchive({
      reviewed: true,
      completedAt: hoursAgo(2),
      digestHeadline: "Today head",
      digestSummary: "today head sum",
      rawItemIds: [todayRawId],
    });

    for (let i = 0; i < 12; i += 1) {
      const rid = await insertRawItem({
        externalId: `recent-${String(i)}`,
        title: `recent-${String(i)}`,
        recapTitle: `recap-${String(i)}`,
        recapSummary: `summary-${String(i)}`,
      });
      await insertArchive({
        reviewed: true,
        completedAt: hoursAgo(72 + i * 24),
        digestHeadline: `Older ${String(i)}`,
        digestSummary: `Older sum ${String(i)}`,
        rawItemIds: [rid],
      });
    }
    await hideOtherReviewed();

    const res = await buildApp().request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.todaysIssue?.runId).toBe(todayRunId);
    expect(body.recentIssues.length).toBeLessThanOrEqual(10);
    expect(body.recentIssues.some((a) => a.runId === todayRunId)).toBe(false);
  });

  it("REQ-010 (limit): without today's issue, recentIssues is exactly 10 when 13 older exist", async () => {
    for (let i = 0; i < 13; i += 1) {
      const rid = await insertRawItem({
        externalId: `nolimit-${String(i)}`,
        title: `t-${String(i)}`,
        recapTitle: `rt-${String(i)}`,
        recapSummary: `rs-${String(i)}`,
      });
      await insertArchive({
        reviewed: true,
        completedAt: hoursAgo(72 + i * 24),
        digestHeadline: `H ${String(i)}`,
        digestSummary: `S ${String(i)}`,
        rawItemIds: [rid],
      });
    }
    await hideOtherReviewed();

    const res = await buildApp().request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.todaysIssue).toBeNull();
    expect(body.recentIssues.length).toBe(10);
  });

  it("REQ-004 / EDGE-002: returns featuredCanon when must-read has entries", async () => {
    await mustReadRepo.create({
      url: `${MUST_READ_PREFIX}only`,
      title: "Only canon",
      author: "X",
      year: 2024,
      annotation: "must read",
    });
    // Wipe any other must-read entries to make this deterministic for findRandom.
    await db.execute(
      sql`DELETE FROM must_read_entries WHERE url NOT LIKE ${MUST_READ_PREFIX + "%"}`,
    );

    const res = await buildApp().request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.featuredCanon).not.toBeNull();
    expect(body.featuredCanon?.url).toBe(`${MUST_READ_PREFIX}only`);
    expect(body.featuredCanon).not.toHaveProperty("updatedAt");
  });

  it("NF-003 / EDGE-013: with 5 distinct must-read entries, 50 calls surface every entry at least once", async () => {
    // Make our seeded entries the only ones so findRandom samples from them.
    await db.execute(sql`DELETE FROM must_read_entries`);
    const seeded: PublicMustReadEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      const row = await mustReadRepo.create({
        url: `${MUST_READ_PREFIX}canon-${String(i)}`,
        title: `Canon ${String(i)}`,
        author: null,
        year: null,
        annotation: `a${String(i)}`,
      });
      seeded.push({
        id: row.id,
        url: row.url,
        title: row.title,
        author: row.author,
        year: row.year,
        annotation: row.annotation,
        addedAt: row.addedAt.toISOString(),
      });
    }
    const seededIds = new Set(seeded.map((e) => e.id));

    const calls = Array.from({ length: 50 }, () =>
      buildApp()
        .request("/api/home")
        .then(async (r): Promise<HomePagePayload> => {
          return (await r.json()) as HomePagePayload;
        }),
    );
    const results = await Promise.all(calls);
    const observed = new Set<string>();
    for (const r of results) {
      expect(r.featuredCanon).not.toBeNull();
      if (r.featuredCanon) {
        expect(seededIds.has(r.featuredCanon.id)).toBe(true);
        observed.add(r.featuredCanon.id);
      }
    }
    expect(observed.size).toBe(5);
  });

  it("REQ-010: recentIssues entries have ArchiveListItem shape", async () => {
    const rawId = await insertRawItem({
      externalId: "shape",
      title: "Shape source",
      recapTitle: "Shape recap",
      recapSummary: "Shape summary",
    });
    await insertArchive({
      reviewed: true,
      completedAt: hoursAgo(72),
      digestHeadline: "Shape headline",
      digestSummary: "Shape digest summary",
      rawItemIds: [rawId],
    });
    await hideOtherReviewed();

    const res = await buildApp().request("/api/home");
    const body = (await res.json()) as HomePagePayload;
    expect(body.recentIssues.length).toBeGreaterThan(0);
    const item: ArchiveListItem = body.recentIssues[0];
    expect(typeof item.runId).toBe("string");
    expect(typeof item.runDate).toBe("string");
    expect(typeof item.storyCount).toBe("number");
    expect(Array.isArray(item.topItems)).toBe(true);
  });
});

