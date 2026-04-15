import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { rawItems } from "@newsletter/shared/db";
import { collectHn } from "@pipeline/collectors/hn.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";
import type { HnCollectConfig } from "@pipeline/types.js";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

describe("HN Collector E2E", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("fetches items from hn.algolia.com and stores them in raw_items", async () => {
    const cfg: HnCollectConfig = {
      feeds: ["newest"],
      count: 5,
      pointsThreshold: 1,
      commentsPerItem: 0,
    };

    const result = await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsStored).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    const rows = await db.select().from(rawItems);
    expect(rows.length).toBeGreaterThanOrEqual(result.itemsStored);

    for (const row of rows) {
      expect(row.sourceType).toBe("hn");
      expect(row.title).toBeTruthy();
      expect(row.url).toBeTruthy();
      expect(row.externalId).toBeTruthy();
      expect(row.engagement).toBeDefined();
    }
  });

  it("fetches comments and stores them in metadata", async () => {
    const cfg: HnCollectConfig = {
      feeds: ["best"],
      count: 3,
      pointsThreshold: 50,
      commentsPerItem: 5,
    };

    const result = await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);

    expect(result.commentsFetched).toBeGreaterThanOrEqual(0);

    const rows = await db.select().from(rawItems);
    for (const row of rows) {
      expect(row.metadata).toHaveProperty("comments");
      expect(Array.isArray(row.metadata.comments)).toBe(true);
    }
  });

  it("deduplicates on repeated collection via upsert", async () => {
    const cfg: HnCollectConfig = {
      feeds: ["newest"],
      count: 5,
      pointsThreshold: 1,
      commentsPerItem: 0,
    };

    await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);
    const firstRunRows = await db.select().from(rawItems);
    const firstRunCount = firstRunRows.length;

    await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);
    const secondRunRows = await db.select().from(rawItems);

    // Same items should be upserted, not duplicated
    expect(secondRunRows.length).toBe(firstRunCount);

    // updatedAt should be refreshed on second run
    for (let i = 0; i < firstRunRows.length; i++) {
      const original = firstRunRows.find(
        (r) => r.externalId === secondRunRows[i].externalId,
      );
      if (original) {
        expect(secondRunRows[i].updatedAt.getTime()).toBeGreaterThanOrEqual(
          original.updatedAt.getTime(),
        );
      }
    }
  });

  it("respects points threshold — all stored items meet minimum", async () => {
    const highThreshold = 100;
    const cfg: HnCollectConfig = {
      feeds: ["best"],
      count: 10,
      pointsThreshold: highThreshold,
      commentsPerItem: 0,
    };

    await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);

    const rows = await db.select().from(rawItems);
    for (const row of rows) {
      expect(row.engagement.points).toBeGreaterThanOrEqual(highThreshold);
    }
  });

  it("stores source_url pointing to news.ycombinator.com", async () => {
    const cfg: HnCollectConfig = {
      feeds: ["newest"],
      count: 3,
      pointsThreshold: 1,
      commentsPerItem: 0,
    };

    await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);

    const rows = await db.select().from(rawItems);
    for (const row of rows) {
      expect(row.sourceUrl).toContain("news.ycombinator.com/item?id=");
    }
  });

  it("respects sinceDays via server-side created_at_i filter", async () => {
    const sinceDays = 1;
    const cfg: HnCollectConfig = {
      feeds: ["newest"],
      count: 20,
      pointsThreshold: 1,
      commentsPerItem: 0,
      sinceDays,
    };

    await collectHn({ rawItemsRepo: createRawItemsRepo(db) }, cfg);

    const rows = await db.select().from(rawItems);
    const cutoff = Date.now() - sinceDays * 86_400_000;
    for (const row of rows) {
      if (row.publishedAt) {
        expect(row.publishedAt.getTime()).toBeGreaterThanOrEqual(cutoff);
      }
    }
  });

});
