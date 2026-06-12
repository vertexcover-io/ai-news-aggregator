/**
 * E2E tests for Phase 3: review edit recording and admin GET exposure.
 *
 * REQ-003: PATCH /api/admin/archives/:runId replaces review_edits rows
 * REQ-004: GET /api/admin/archives/:runId returns preReviewSnapshot + reviewEdits[]
 * REQ-005: GET /api/archives/:runId (public) does NOT include those fields
 * REQ-006: No-op PATCH writes 0 edit rows
 * REQ-007: Pre-migration archive (snapshot=NULL) PATCHes successfully with 0 edits
 * EDGE-008: DELETE archive cascades to review_edits
 * EDGE-010: Public GET excludes preReviewSnapshot and reviewEdits
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { createRedisConnection } from "@newsletter/shared";
import { getDb, rawItems, reviewEdits, runArchives } from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared";
import type { PreReviewSnapshot } from "@newsletter/shared/review-edits";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createReviewEditsRepo } from "@api/repositories/review-edits.js";
import {
  createAdminArchivesRouter,
  createPublicArchivesRouter,
} from "@api/routes/archives.js";
import { ensureE2eTenant } from "./helpers/tenant.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const redis = createRedisConnection();
const tenantCtx = await ensureE2eTenant();
const rawItemsRepo = createRawItemsRepo(db, tenantCtx);
const archiveRepo = createRunArchivesRepo(db, tenantCtx);
const reviewEditsRepo = createReviewEditsRepo(db, tenantCtx);

// Track seeded resources for cleanup
const seededRunIds = new Set<string>();
const seededRawItemIds = new Set<number>();
const seedPrefix = `p3-re-${String(Date.now())}`;

function buildAdminApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/admin/archives",
    createAdminArchivesRouter({
      getArchiveRepo: () => archiveRepo,
      getRawItemsRepo: () => rawItemsRepo,
      getReviewEditsRepo: () => reviewEditsRepo,
      redis,
    }),
  );
  return app;
}

function buildPublicApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/archives",
    createPublicArchivesRouter({
      getArchiveRepo: () => archiveRepo,
      getRawItemsRepo: () => rawItemsRepo,
    }),
  );
  return app;
}

async function insertRawItem(externalId: string, recap?: {
  title: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
}): Promise<number> {
  const [row] = await db
    .insert(rawItems)
    .values({
      tenantId: tenantCtx.tenantId,
      sourceType: "hn",
      externalId: `${seedPrefix}-${externalId}`,
      title: `Title for ${externalId}`,
      url: `https://example.com/${seedPrefix}/${externalId}`,
      author: "review-edits-e2e",
      publishedAt: new Date("2099-01-01T00:00:00Z"),
      engagement: { points: 10, commentCount: 2 },
      metadata: {
        comments: [],
        recap: recap ?? {
          title: `Recap title for ${externalId}`,
          summary: `Recap summary for ${externalId}`,
          bullets: ["bullet 1", "bullet 2"],
          bottomLine: `Bottom line for ${externalId}`,
        },
      },
    })
    .returning({ id: rawItems.id });
  seededRawItemIds.add(row.id);
  return row.id;
}

async function insertArchive(opts: {
  rawItemIds: readonly number[];
  reviewed?: boolean;
  preReviewSnapshot?: PreReviewSnapshot | null;
  digestHeadline?: string | null;
  digestSummary?: string | null;
  hook?: string | null;
  twitterSummary?: string | null;
}): Promise<{ runId: string; rawItemIds: readonly number[] }> {
  const runId = randomUUID();
  const rankedItems: RankedItemRef[] = opts.rawItemIds.map((rawItemId, index) => ({
    rawItemId,
    score: 1 - index * 0.1,
    rationale: `item ${String(index + 1)}`,
  }));

  await db.insert(runArchives).values({
    id: runId,
    tenantId: tenantCtx.tenantId,
    status: "completed",
    rankedItems,
    topN: rankedItems.length,
    reviewed: opts.reviewed ?? false,
    completedAt: new Date("2099-06-01T10:00:00Z"),
    startedAt: new Date("2099-06-01T09:00:00Z"),
    sourceTypes: ["hn"],
    digestHeadline: opts.digestHeadline ?? "Test headline",
    digestSummary: opts.digestSummary ?? "Test summary",
    hook: opts.hook ?? null,
    twitterSummary: opts.twitterSummary ?? null,
    isDryRun: false,
    preReviewSnapshot: opts.preReviewSnapshot !== undefined ? opts.preReviewSnapshot : null,
  });
  seededRunIds.add(runId);
  return { runId, rawItemIds: opts.rawItemIds };
}

async function countEditRows(runId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reviewEdits)
    .where(eq(reviewEdits.runId, runId));
  return rows[0]?.count ?? 0;
}

async function listEditRows(runId: string): Promise<typeof reviewEdits.$inferSelect[]> {
  return db
    .select()
    .from(reviewEdits)
    .where(eq(reviewEdits.runId, runId))
    .orderBy(reviewEdits.id);
}

async function cleanupSeeds(): Promise<void> {
  if (seededRunIds.size > 0) {
    // review_edits cascade on archive delete — just delete archives
    await db.delete(runArchives).where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededRawItemIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawItemIds]));
    seededRawItemIds.clear();
  }
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

// ── helpers for building snapshot ────────────────────────────────────────────

function buildSnapshot(
  rawItemIds: readonly number[],
  recapOverrides?: Partial<{
    title: string;
    summary: string;
    bullets: string[];
    bottomLine: string;
  }>,
  digestMetaOverrides?: Partial<PreReviewSnapshot["digestMeta"]>,
): PreReviewSnapshot {
  const recap: PreReviewSnapshot["recap"] = {};
  for (const id of rawItemIds) {
    recap[id] = {
      title: recapOverrides?.title ?? `Recap title for item ${String(id)}`,
      summary: recapOverrides?.summary ?? `Recap summary for item ${String(id)}`,
      bullets: recapOverrides?.bullets ?? ["bullet 1", "bullet 2"],
      bottomLine: recapOverrides?.bottomLine ?? `Bottom line for item ${String(id)}`,
    };
  }
  return {
    capturedAt: "2099-06-01T09:30:00.000Z",
    rankedItemIds: [...rawItemIds],
    recap,
    digestMeta: {
      headline: "Snapshot headline",
      summary: "Snapshot summary",
      hook: "Snapshot hook",
      twitterSummary: "Snapshot twitter",
      ...digestMetaOverrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — REQ-003 happy path: mixed edits produce correct edit rows
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/archives/:runId — REQ-003 happy path (e2e)", () => {
  it("records reorder, remove, add, text_edit, and digest_headline edit rows in a single PATCH", async () => {
    // Seed: 4 raw items, archive with snapshot containing items 0..3
    const [id0, id1, id2, id3] = await Promise.all([
      insertRawItem("happy-0"),
      insertRawItem("happy-1"),
      insertRawItem("happy-2"),
      insertRawItem("happy-3"),
    ]);
    // Snapshot: [id0, id1, id2] in that order. id3 is not in snapshot (pool item).
    const snapshot = buildSnapshot([id0, id1, id2]);
    const archive = await insertArchive({
      rawItemIds: [id0, id1, id2],
      preReviewSnapshot: snapshot,
      digestHeadline: "Snapshot headline",
      digestSummary: "Snapshot summary",
    });

    // Patch: reorder (swap 0 and 1), remove id2, add id3, edit bottomLine on id0,
    // change digestHeadline.
    const res = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [
            { id: id1, sourceType: "hn" },
            { id: id0, sourceType: "hn", bottomLine: "Edited bottom line" },
            { id: id3, sourceType: "hn" },
          ],
          digestHeadline: "New headline",
        }),
      },
    );

    expect(res.status).toBe(200);

    const edits = await listEditRows(archive.runId);

    // Expect: remove(id2), add(id3), reorder(id0 0→1), reorder(id1 1→0),
    //         text_edit(bottomLine on id0), text_edit(digest_headline)
    const byType = (t: string) => edits.filter((e) => e.editType === t);
    const removes = byType("remove");
    const adds = byType("add");
    const reorders = byType("reorder");
    const textEdits = byType("text_edit");

    expect(removes).toHaveLength(1);
    expect(removes[0]?.rawItemId).toBe(id2);
    expect(removes[0]?.positionBefore).toBe(2);
    expect(removes[0]?.positionAfter).toBeNull();

    expect(adds).toHaveLength(1);
    expect(adds[0]?.rawItemId).toBe(id3);
    expect(adds[0]?.positionBefore).toBeNull();
    expect(adds[0]?.positionAfter).toBe(2);

    expect(reorders).toHaveLength(2);
    const reorderedIds = reorders.map((r) => r.rawItemId).sort();
    expect(reorderedIds).toEqual([id0, id1].sort());

    // text_edit: bottomLine on id0 + digest_headline change
    expect(textEdits).toHaveLength(2);
    const bottomLineEdit = textEdits.find((e) => e.field === "bottomLine");
    expect(bottomLineEdit).toBeDefined();
    expect(bottomLineEdit?.rawItemId).toBe(id0);
    expect(bottomLineEdit?.after).toBe("Edited bottom line");

    const headlineEdit = textEdits.find((e) => e.field === "digest_headline");
    expect(headlineEdit).toBeDefined();
    expect(headlineEdit?.rawItemId).toBeNull();
    expect(headlineEdit?.before).toBe("Snapshot headline");
    expect(headlineEdit?.after).toBe("New headline");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — REQ-006 no-op PATCH writes 0 rows
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/archives/:runId — REQ-006 no-op (e2e)", () => {
  it("writes 0 review_edits rows when patch is identical to snapshot", async () => {
    const [id0, id1] = await Promise.all([
      insertRawItem("noop-0"),
      insertRawItem("noop-1"),
    ]);
    const snapshot = buildSnapshot([id0, id1]);
    const archive = await insertArchive({
      rawItemIds: [id0, id1],
      preReviewSnapshot: snapshot,
      digestHeadline: "Snapshot headline",
    });

    // PATCH with same order, no overrides, same digestHeadline
    const res = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [
            { id: id0, sourceType: "hn" },
            { id: id1, sourceType: "hn" },
          ],
          // digestHeadline matches snapshot — no change
          digestHeadline: "Snapshot headline",
        }),
      },
    );

    expect(res.status).toBe(200);
    const count = await countEditRows(archive.runId);
    expect(count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — REQ-007 pre-migration archive (snapshot=NULL) PATCHes with 0 edits
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/archives/:runId — REQ-007 pre-migration (e2e)", () => {
  it("PATCHes successfully and writes 0 review_edits rows when snapshot is NULL", async () => {
    const id = await insertRawItem("premig-0");
    // No preReviewSnapshot — simulates pre-migration archive
    const archive = await insertArchive({
      rawItemIds: [id],
      preReviewSnapshot: null,
    });

    const res = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [{ id, sourceType: "hn" }],
          digestHeadline: "Some new headline",
        }),
      },
    );

    expect(res.status).toBe(200);
    const count = await countEditRows(archive.runId);
    expect(count).toBe(0);

    // Archive update still landed
    const rows = await db
      .select({ reviewed: runArchives.reviewed, digestHeadline: runArchives.digestHeadline })
      .from(runArchives)
      .where(eq(runArchives.id, archive.runId));
    expect(rows[0]?.reviewed).toBe(true);
    expect(rows[0]?.digestHeadline).toBe("Some new headline");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — REQ-003 idempotency: re-PATCH replaces edit rows
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/archives/:runId — REQ-003 idempotency (e2e)", () => {
  it("second PATCH replaces edit rows from first PATCH", async () => {
    const [id0, id1, id2] = await Promise.all([
      insertRawItem("idem-0"),
      insertRawItem("idem-1"),
      insertRawItem("idem-2"),
    ]);
    const snapshot = buildSnapshot([id0, id1, id2]);
    const archive = await insertArchive({
      rawItemIds: [id0, id1, id2],
      preReviewSnapshot: snapshot,
    });

    // First PATCH: remove id2
    const firstRes = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [
            { id: id0, sourceType: "hn" },
            { id: id1, sourceType: "hn" },
          ],
        }),
      },
    );
    expect(firstRes.status).toBe(200);
    const firstCount = await countEditRows(archive.runId);
    expect(firstCount).toBeGreaterThan(0); // remove(id2)

    // Second PATCH: put id2 back, remove id1
    const secondRes = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankedItems: [
            { id: id0, sourceType: "hn" },
            { id: id2, sourceType: "hn" },
          ],
        }),
      },
    );
    expect(secondRes.status).toBe(200);

    const secondEdits = await listEditRows(archive.runId);
    // Should only have rows for edit B (id1 removed), not edit A (id2 removed)
    const removedIds = secondEdits
      .filter((e) => e.editType === "remove")
      .map((e) => e.rawItemId);
    expect(removedIds).toContain(id1);
    expect(removedIds).not.toContain(id2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — REQ-004: admin GET returns preReviewSnapshot and reviewEdits[]
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/admin/archives/:runId — REQ-004 (e2e)", () => {
  it("returns preReviewSnapshot and reviewEdits[] in admin GET response", async () => {
    const [id0, id1] = await Promise.all([
      insertRawItem("admin-get-0"),
      insertRawItem("admin-get-1"),
    ]);
    const snapshot = buildSnapshot([id0, id1]);
    const archive = await insertArchive({
      rawItemIds: [id0, id1],
      reviewed: true,
      preReviewSnapshot: snapshot,
    });

    // Seed one edit row directly via PATCH (reorder)
    await buildAdminApp().request(`/api/admin/archives/${archive.runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [
          { id: id1, sourceType: "hn" },
          { id: id0, sourceType: "hn" },
        ],
      }),
    });

    const res = await buildAdminApp().request(`/api/admin/archives/${archive.runId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;

    // preReviewSnapshot is returned
    expect(Object.prototype.hasOwnProperty.call(body, "preReviewSnapshot")).toBe(true);
    const snapshotField = body.preReviewSnapshot as PreReviewSnapshot | null;
    expect(snapshotField).not.toBeNull();
    expect(snapshotField?.capturedAt).toBe(snapshot.capturedAt);
    expect(snapshotField?.rankedItemIds).toEqual([id0, id1]);

    // reviewEdits[] is returned and has at least the reorder rows
    expect(Object.prototype.hasOwnProperty.call(body, "reviewEdits")).toBe(true);
    const editsField = body.reviewEdits as unknown[];
    expect(Array.isArray(editsField)).toBe(true);
    expect(editsField.length).toBeGreaterThan(0);
    const types = editsField.map((e) => (e as Record<string, unknown>).editType);
    expect(types.every((t) => t === "reorder")).toBe(true);
  });

  it("returns preReviewSnapshot=null and reviewEdits=[] when snapshot is NULL and no review done", async () => {
    const id = await insertRawItem("admin-get-null");
    const archive = await insertArchive({
      rawItemIds: [id],
      reviewed: true,
      preReviewSnapshot: null,
    });

    const res = await buildAdminApp().request(`/api/admin/archives/${archive.runId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "preReviewSnapshot")).toBe(true);
    expect(body.preReviewSnapshot).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(body, "reviewEdits")).toBe(true);
    expect(body.reviewEdits).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 — REQ-005 / EDGE-010: public GET excludes preReviewSnapshot and reviewEdits
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/archives/:runId — REQ-005 / EDGE-010 (e2e)", () => {
  it("public GET does NOT include preReviewSnapshot or reviewEdits (byte-identical baseline)", async () => {
    const [id0, id1] = await Promise.all([
      insertRawItem("pub-excl-0"),
      insertRawItem("pub-excl-1"),
    ]);
    const snapshot = buildSnapshot([id0, id1]);
    const archive = await insertArchive({
      rawItemIds: [id0, id1],
      reviewed: true,
      preReviewSnapshot: snapshot,
    });

    // Seed some edit rows via PATCH
    await buildAdminApp().request(`/api/admin/archives/${archive.runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [
          { id: id1, sourceType: "hn" },
          { id: id0, sourceType: "hn" },
        ],
      }),
    });

    const res = await buildPublicApp().request(`/api/archives/${archive.runId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;

    // Fields must NOT be present on public response
    expect(Object.prototype.hasOwnProperty.call(body, "preReviewSnapshot")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "reviewEdits")).toBe(false);
    // Admin-only fields also absent
    expect(Object.prototype.hasOwnProperty.call(body, "twitterSummary")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "shortlistedItemIds")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7 — EDGE-008: DELETE archive cascades to review_edits
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/archives/:runId — EDGE-008 cascade (e2e)", () => {
  it("cascade-deletes review_edits rows when archive is deleted", async () => {
    const [id0, id1, id2] = await Promise.all([
      insertRawItem("cascade-0"),
      insertRawItem("cascade-1"),
      insertRawItem("cascade-2"),
    ]);
    const snapshot = buildSnapshot([id0, id1, id2]);
    const archive = await insertArchive({
      rawItemIds: [id0, id1, id2],
      preReviewSnapshot: snapshot,
    });

    // PATCH to create some edit rows (remove id2)
    await buildAdminApp().request(`/api/admin/archives/${archive.runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [
          { id: id0, sourceType: "hn" },
          { id: id1, sourceType: "hn" },
        ],
      }),
    });

    const beforeCount = await countEditRows(archive.runId);
    expect(beforeCount).toBeGreaterThan(0);

    // DELETE the archive
    const deleteRes = await buildAdminApp().request(
      `/api/admin/archives/${archive.runId}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(204);

    // review_edits should be gone (cascade)
    const afterCount = await countEditRows(archive.runId);
    expect(afterCount).toBe(0);

    // Don't re-delete in cleanup since archive is already gone
    seededRunIds.delete(archive.runId);
  });
});
