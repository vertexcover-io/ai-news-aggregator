import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

describe("Database Schema E2E", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("inserts a raw_item and reads it back", async () => {
    const [item] = await db
      .insert(rawItems)
      .values({
        sourceType: "hn",
        externalId: "12345",
        title: "Test Article",
        url: "https://example.com/article",
        sourceUrl: "https://news.ycombinator.com/item?id=12345",
        author: "testuser",
        engagement: { points: 100, commentCount: 50 },
        metadata: { comments: [] },
      })
      .returning();

    expect(item.sourceType).toBe("hn");
    expect(item.externalId).toBe("12345");
    expect(item.title).toBe("Test Article");
    expect(item.engagement).toEqual({ points: 100, commentCount: 50 });
  });

  it("enforces unique constraint on (source_type, external_id)", async () => {
    await db.insert(rawItems).values({
      sourceType: "hn",
      externalId: "99999",
      title: "First Insert",
      url: "https://example.com/first",
    });

    await db
      .insert(rawItems)
      .values({
        sourceType: "hn",
        externalId: "99999",
        title: "Updated Title",
        url: "https://example.com/updated",
      })
      .onConflictDoUpdate({
        target: [rawItems.sourceType, rawItems.externalId],
        set: {
          title: "Updated Title",
          url: "https://example.com/updated",
          updatedAt: new Date(),
        },
      });

    const rows = await db
      .select()
      .from(rawItems)
      .where(eq(rawItems.externalId, "99999"));

    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Updated Title");
    expect(rows[0].url).toBe("https://example.com/updated");
  });

  it("stores and retrieves JSONB engagement and metadata correctly", async () => {
    const engagement = { points: 250, commentCount: 80, upvotes: 300 };
    const metadata = {
      comments: [
        { id: "1", author: "user1", content: "Great post", publishedAt: "2026-01-01" },
        { id: "2", author: "user2", content: "Interesting", publishedAt: "2026-01-02" },
      ],
      tags: ["ai", "ml"],
    };

    const [inserted] = await db
      .insert(rawItems)
      .values({
        sourceType: "hn",
        externalId: "77777",
        title: "JSONB Test",
        url: "https://example.com/jsonb",
        engagement,
        metadata,
      })
      .returning();

    expect(inserted.engagement).toEqual(engagement);
    expect(inserted.metadata).toEqual(metadata);
  });
});
