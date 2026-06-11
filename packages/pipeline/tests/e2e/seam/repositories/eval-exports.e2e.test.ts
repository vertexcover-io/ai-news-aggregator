/**
 * VS-5 — e2e seam test for eval-exports repository.
 *
 * Proves, against the LIVE test DB + Redis, that calendar-mode eval
 * reconstructs the DEDUPED candidate pool attributed by run_id, and that
 * the pool is strictly larger than the ranked subset.
 *
 * Scenarios covered:
 *   VS-5 (REQ-004/006/007/009): run_id attribution, dedup, pool > ranked subset
 *   EDGE-001 (REQ-004): multi-run isolation — R2 items excluded from R's pool
 *   REQ-005/EDGE-003: legacy fallback — null run_id, window fallback, pool deduped
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { rawItems, runArchives } from "@newsletter/shared/db";
import { AGENTLOOP_TENANT_ID } from "@newsletter/shared";
import { createEvalExportsRepo } from "@pipeline/repositories/eval-exports.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";
import type { RankedItemRef } from "@newsletter/shared/types";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a run_archives row. startedAt/completedAt must bracket the raw_items. */
async function seedArchive(
  db: AppDb,
  opts: {
    id: string;
    rankedItemIds: number[];
    startedAt: Date;
    completedAt: Date;
    topN?: number;
  },
): Promise<void> {
  const rankedItems: RankedItemRef[] = opts.rankedItemIds.map((rawItemId, i) => ({
    rawItemId,
    score: 1 - i * 0.1,
    rationale: "seeded",
  }));
  await db.insert(runArchives).values({
            tenantId: AGENTLOOP_TENANT_ID,
    id: opts.id,
    status: "completed",
    rankedItems,
    topN: opts.topN ?? opts.rankedItemIds.length,
    completedAt: opts.completedAt,
    startedAt: opts.startedAt,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("eval-exports repo e2e — VS-5", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    // truncateAll only truncates raw_items; also truncate run_archives
    await db.execute(sql`TRUNCATE TABLE run_archives RESTART IDENTITY CASCADE`);
  });

  // -------------------------------------------------------------------------
  // VS-5 core — run_id attribution + dedup + pool > ranked subset
  // -------------------------------------------------------------------------
  it(
    "VS-5: sourcePool is loaded by run_id, deduped (duplicate collapses to higher-engagement survivor), and larger than rankedItems",
    async () => {
      const runId = randomUUID();
      const startedAt = new Date(Date.now() - 120_000); // 2 min ago
      const completedAt = new Date(Date.now() - 60_000); // 1 min ago

      // Seed 5 raw_items stamped with run_id = runId:
      //   item-A and item-A-dup share the same canonical URL → dedup collapses to
      //   item-A (higher engagement). item-B, item-C, item-D are unique.
      //   ranked subset = [item-A, item-B] (topN=2), leaving item-C and item-D
      //   in the pool but not in rankedItems.
      const inserted = await db
        .insert(rawItems)
        .values([
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runId}-A`,
            title: "Item A",
            url: "https://example.com/article-a",
            engagement: { points: 200, commentCount: 20 },
            metadata: { comments: [] },
            runId,
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            // duplicate of A — same canonical URL (UTM stripped), lower engagement
            sourceType: "reddit",
            externalId: `${runId}-A-dup`,
            title: "Item A dup",
            url: "https://example.com/article-a?utm_source=reddit",
            engagement: { points: 10, commentCount: 1 },
            metadata: { comments: [] },
            runId,
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runId}-B`,
            title: "Item B",
            url: "https://example.com/article-b",
            engagement: { points: 150, commentCount: 15 },
            metadata: { comments: [] },
            runId,
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runId}-C`,
            title: "Item C",
            url: "https://example.com/article-c",
            engagement: { points: 80, commentCount: 8 },
            metadata: { comments: [] },
            runId,
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runId}-D`,
            title: "Item D",
            url: "https://example.com/article-d",
            engagement: { points: 60, commentCount: 6 },
            metadata: { comments: [] },
            runId,
          },
        ])
        .returning({ id: rawItems.id });

      // ids: A=0, A-dup=1, B=2, C=3, D=4
      const [idA, , idB] = inserted.map((r) => r.id);

      // ranked subset = top 2 (A and B)
      await seedArchive(db, {
        id: runId,
        rankedItemIds: [idA, idB],
        startedAt,
        completedAt,
        topN: 5,
      });

      const repo = createEvalExportsRepo(db);
      const detail = await repo.getCompletedRunDetail(runId);

      expect(detail).not.toBeNull();
      if (detail === null) return; // narrow type for TS

      const { sourcePool, previousRanking } = detail;

      // REQ-006: duplicate collapsed — pool should NOT contain the lower-engagement dup
      const poolUrls = sourcePool.map((i) => i.url);
      const dedupedUrl = "https://example.com/article-a";
      const dupUrl = "https://example.com/article-a?utm_source=reddit";
      // only one entry for the deduplicated URL
      expect(poolUrls.filter((u) => u.startsWith(dedupedUrl)).length).toBe(1);
      // the lower-engagement dup should be absent
      expect(poolUrls).not.toContain(dupUrl);

      // REQ-007: pool strictly larger than ranked subset
      expect(sourcePool.length).toBeGreaterThan(previousRanking.length);
      // 5 items → 1 dup removed → 4 survivors; rankedItems = 2
      expect(sourcePool.length).toBe(4);
      expect(previousRanking.length).toBe(2);

      // REQ-009: itemCount === sourcePool.length
      expect(detail.itemCount).toBe(sourcePool.length);

      // REQ-004: the pool was loaded by run_id (not time window);
      // verify all returned items belong to this run by checking their IDs
      // correspond to the items we seeded under this runId
      const survivorIds = new Set(sourcePool.map((i) => i.rawItemId));
      // item A and B should be present (highest engagement survivors)
      expect(survivorIds.has(idA)).toBe(true);
      expect(survivorIds.has(idB)).toBe(true);
    },
  );

  // -------------------------------------------------------------------------
  // EDGE-001 — multi-run isolation
  // -------------------------------------------------------------------------
  it(
    "EDGE-001: getCompletedRunDetail(R) excludes items stamped with run_id = R2 (same day)",
    async () => {
      const runR = randomUUID();
      const runR2 = randomUUID();
      const startedAt = new Date(Date.now() - 120_000);
      const completedAt = new Date(Date.now() - 60_000);

      // Seed items for run R
      const insertedR = await db
        .insert(rawItems)
        .values([
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runR}-X`,
            title: "Run R - Item X",
            url: "https://example.com/r-item-x",
            engagement: { points: 100, commentCount: 10 },
            metadata: { comments: [] },
            runId: runR,
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runR}-Y`,
            title: "Run R - Item Y",
            url: "https://example.com/r-item-y",
            engagement: { points: 90, commentCount: 9 },
            metadata: { comments: [] },
            runId: runR,
          },
        ])
        .returning({ id: rawItems.id });

      // Seed items for run R2 (same day, different run_id)
      await db.insert(rawItems).values([
        {
            tenantId: AGENTLOOP_TENANT_ID,
          sourceType: "hn",
          externalId: `${runR2}-Z`,
          title: "Run R2 - Item Z",
          url: "https://example.com/r2-item-z",
          engagement: { points: 200, commentCount: 20 },
          metadata: { comments: [] },
          runId: runR2,
        },
      ]);

      // Seed archives for both runs
      await seedArchive(db, {
        id: runR,
        rankedItemIds: [insertedR[0].id],
        startedAt,
        completedAt,
        topN: 5,
      });
      await seedArchive(db, {
        id: runR2,
        rankedItemIds: [],
        startedAt: new Date(completedAt.getTime() + 1000),
        completedAt: new Date(completedAt.getTime() + 5000),
        topN: 5,
      });

      const repo = createEvalExportsRepo(db);
      const detailR = await repo.getCompletedRunDetail(runR);

      expect(detailR).not.toBeNull();
      if (detailR === null) return; // narrow type for TS

      const poolUrls = detailR.sourcePool.map((i) => i.url);

      // R's pool should contain R's items
      expect(poolUrls).toContain("https://example.com/r-item-x");
      expect(poolUrls).toContain("https://example.com/r-item-y");
      // R's pool must NOT contain R2's items
      expect(poolUrls).not.toContain("https://example.com/r2-item-z");

      // itemCount should only count R's items
      expect(detailR.itemCount).toBe(2);
    },
  );

  // -------------------------------------------------------------------------
  // REQ-005 / EDGE-003 — legacy fallback (null run_id)
  // -------------------------------------------------------------------------
  it(
    "REQ-005/EDGE-003: archive R3 with run_id=NULL on raw_items falls back to time window, pool is non-empty and deduped",
    async () => {
      const runR3 = randomUUID();
      const startedAt = new Date(Date.now() - 180_000); // 3 min ago
      const completedAt = new Date(Date.now() - 90_000); // 1.5 min ago

      // Seed items with run_id = NULL but collectedAt inside [startedAt, completedAt]
      // Include a duplicate pair to verify dedup runs on the window-fallback path too
      const insertedR3 = await db
        .insert(rawItems)
        .values([
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runR3}-legacy-P`,
            title: "Legacy Item P",
            url: "https://legacy.example.com/p",
            engagement: { points: 300, commentCount: 30 },
            metadata: { comments: [] },
            collectedAt: new Date(startedAt.getTime() + 1000),
            // runId is omitted → NULL
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            // duplicate of P, lower engagement
            sourceType: "reddit",
            externalId: `${runR3}-legacy-P-dup`,
            title: "Legacy Item P dup",
            url: "https://legacy.example.com/p?utm_source=rss",
            engagement: { points: 10, commentCount: 1 },
            metadata: { comments: [] },
            collectedAt: new Date(startedAt.getTime() + 2000),
          },
          {
            tenantId: AGENTLOOP_TENANT_ID,
            sourceType: "hn",
            externalId: `${runR3}-legacy-Q`,
            title: "Legacy Item Q",
            url: "https://legacy.example.com/q",
            engagement: { points: 150, commentCount: 15 },
            metadata: { comments: [] },
            collectedAt: new Date(startedAt.getTime() + 3000),
          },
        ])
        .returning({ id: rawItems.id });

      const [idP] = insertedR3.map((r) => r.id);

      await seedArchive(db, {
        id: runR3,
        rankedItemIds: [idP],
        startedAt,
        completedAt,
        topN: 5,
      });

      const repo = createEvalExportsRepo(db);
      const detail = await repo.getCompletedRunDetail(runR3);

      expect(detail).not.toBeNull();
      if (detail === null) return; // narrow type for TS

      const { sourcePool } = detail;

      // non-empty: fallback loaded window items
      expect(sourcePool.length).toBeGreaterThan(0);

      // deduped: P and its dup share a canonical URL → only 1 entry
      const poolUrls = sourcePool.map((i) => i.url);
      const legacyPUrls = poolUrls.filter((u) =>
        u.startsWith("https://legacy.example.com/p"),
      );
      expect(legacyPUrls.length).toBe(1);

      // Q is present
      expect(poolUrls).toContain("https://legacy.example.com/q");

      // itemCount matches pool length (REQ-009)
      expect(detail.itemCount).toBe(sourcePool.length);

      // pool should have 2 survivors (P and Q; P-dup removed)
      expect(sourcePool.length).toBe(2);
    },
  );
});
