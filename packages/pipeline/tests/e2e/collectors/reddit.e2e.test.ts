import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { sources, rawItems } from "@newsletter/shared/db";
import { eq } from "drizzle-orm";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll, closeTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";
import type { RedditCollectConfig } from "@pipeline/types.js";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

describe("Reddit Collector E2E", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
    return async () => {
      await closeTestDb();
    };
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("fetches items from Reddit and stores them in raw_items", async () => {
    const cfg: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      sort: "top",
      timeframe: "week",
      limit: 5,
      commentsPerItem: 0,
    };

    const result = await collectReddit({ rawItemsRepo: createRawItemsRepo(db) }, null, cfg);

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsStored).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    const rows = await db.select().from(rawItems).where(eq(rawItems.sourceType, "reddit"));
    expect(rows.length).toBeGreaterThanOrEqual(result.itemsStored);

    for (const row of rows) {
      expect(row.sourceType).toBe("reddit");
      expect(row.title).toBeTruthy();
      expect(row.url).toBeTruthy();
      expect(row.externalId).toBeTruthy();
      expect(row.engagement).toBeDefined();
    }
  });

  it("fetches comments and stores them in metadata", async () => {
    const cfg: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      sort: "top",
      timeframe: "week",
      limit: 3,
      commentsPerItem: 3,
    };

    const result = await collectReddit({ rawItemsRepo: createRawItemsRepo(db) }, null, cfg);

    expect(result.commentsFetched).toBeGreaterThanOrEqual(0);

    const rows = await db.select().from(rawItems).where(eq(rawItems.sourceType, "reddit"));
    for (const row of rows) {
      expect(row.metadata).toHaveProperty("comments");
      expect(Array.isArray(row.metadata.comments)).toBe(true);
    }
  });

  it("deduplicates on repeated collection via upsert", async () => {
    const cfg: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      sort: "top",
      timeframe: "week",
      limit: 5,
      commentsPerItem: 0,
    };

    await collectReddit({ rawItemsRepo: createRawItemsRepo(db) }, null, cfg);
    const firstRunRows = await db.select().from(rawItems).where(eq(rawItems.sourceType, "reddit"));
    const firstRunCount = firstRunRows.length;

    await collectReddit({ rawItemsRepo: createRawItemsRepo(db) }, null, cfg);
    const secondRunRows = await db.select().from(rawItems).where(eq(rawItems.sourceType, "reddit"));

    expect(secondRunRows.length).toBe(firstRunCount);

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

  it("stores sourceUrl pointing to reddit.com", async () => {
    const cfg: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      sort: "top",
      timeframe: "week",
      limit: 3,
      commentsPerItem: 0,
    };

    await collectReddit({ rawItemsRepo: createRawItemsRepo(db) }, null, cfg);

    const rows = await db.select().from(rawItems).where(eq(rawItems.sourceType, "reddit"));
    for (const row of rows) {
      expect(row.sourceUrl).toContain("reddit.com/r/");
    }
  });

  it("associates items with a source when sourceId is provided", async () => {
    const [source] = await db
      .insert(sources)
      .values({ name: "Reddit", type: "reddit", url: "https://reddit.com" })
      .returning();

    const cfg: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      sort: "top",
      timeframe: "week",
      limit: 3,
      commentsPerItem: 0,
    };

    await collectReddit({ rawItemsRepo: createRawItemsRepo(db) }, source.id, cfg);

    const rows = await db.select().from(rawItems).where(eq(rawItems.sourceType, "reddit"));
    for (const row of rows) {
      expect(row.sourceId).toBe(source.id);
    }
  });
});
