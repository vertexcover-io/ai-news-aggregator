/**
 * Regression test for the production crash observed on run b91d826e
 * (Slack: "Web sources: ON CONFLICT DO UPDATE command cannot affect row a
 * second time (0 retries) — failed").
 *
 * Root cause: when a single upsertItems() batch contains two RawItemInsert
 * rows with the same (sourceType, externalId), Postgres rejects the whole
 * INSERT ... ON CONFLICT DO UPDATE statement with error 21000:
 *   "ON CONFLICT DO UPDATE command cannot affect row a second time"
 *
 * The blog collector triggers this when two listing pages cross-link the
 * same post URL (e.g. latent.space links to a hugobowne.substack.com post
 * AND hugobowne's own listing surfaces the same post in one run).
 *
 * This file's tests MUST FAIL against the current implementation. They
 * pass once upsertItems is fixed to dedup within the batch.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { RawItemInsert } from "@newsletter/shared/db";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

function makeItem(overrides: Partial<RawItemInsert> = {}): RawItemInsert {
  const now = new Date("2026-05-23T12:00:00Z");
  return {
    sourceType: "blog",
    externalId: "https://hugobowne.substack.com/p/ai-agent-harness",
    title: "Agent harness principles",
    url: "https://hugobowne.substack.com/p/ai-agent-harness",
    sourceUrl: "https://hugobowne.substack.com/",
    author: "Hugo Bowne-Anderson",
    content: null,
    imageUrl: null,
    publishedAt: now,
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    updatedAt: now,
    ...overrides,
  };
}

describe("createRawItemsRepo.upsertItems — within-batch dedup", () => {
  beforeAll(() => {
    // Force connection initialization; throws if DATABASE_URL is missing
    getTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // PRIMARY REGRESSION: two rows with identical (sourceType, externalId)
  // in one batch must NOT crash. This is the exact failure mode from
  // run b91d826e.
  it("does not throw when batch contains two items with the same (sourceType, externalId)", async () => {
    const repo = createRawItemsRepo(getTestDb());

    const dup1 = makeItem({ title: "First copy" });
    const dup2 = makeItem({ title: "Second copy (cross-linked)" });

    // Currently throws:
    //   PostgresError: ON CONFLICT DO UPDATE command cannot affect row
    //   a second time
    // After the dedup fix, this resolves to undefined.
    await expect(repo.upsertItems([dup1, dup2])).resolves.toBeUndefined();
  });

  // Once the crash is fixed, the surviving row should reflect last-write-wins
  // semantics, matching what ON CONFLICT DO UPDATE would have produced if
  // the duplicates had been issued as separate statements.
  it("last write wins when batch contains duplicates", async () => {
    const repo = createRawItemsRepo(getTestDb());

    const first = makeItem({
      title: "First copy",
      engagement: { points: 1, commentCount: 0 },
    });
    const second = makeItem({
      title: "Second copy (cross-linked)",
      engagement: { points: 42, commentCount: 7 },
    });

    await repo.upsertItems([first, second]);

    const row = await repo.findBySourceAndExternalId(
      "blog",
      "https://hugobowne.substack.com/p/ai-agent-harness",
    );
    expect(row).not.toBeNull();
    // Engagement is overwritten on conflict via excluded.engagement, so the
    // second occurrence must win. Title is NOT in the set clause, so it
    // reflects whichever copy was actually INSERTed (the surviving one
    // after dedup).
    expect(row?.engagement.points).toBe(42);
    expect(row?.engagement.commentCount).toBe(7);
  });

  // EDGE: different externalId values in the same batch must continue
  // to work (no false-positive dedup).
  it("inserts two distinct items in the same batch without dedup", async () => {
    const repo = createRawItemsRepo(getTestDb());

    const a = makeItem({
      externalId: "https://hugobowne.substack.com/p/post-a",
      url: "https://hugobowne.substack.com/p/post-a",
      title: "Post A",
    });
    const b = makeItem({
      externalId: "https://hugobowne.substack.com/p/post-b",
      url: "https://hugobowne.substack.com/p/post-b",
      title: "Post B",
    });

    await repo.upsertItems([a, b]);

    const rowA = await repo.findBySourceAndExternalId(
      "blog",
      "https://hugobowne.substack.com/p/post-a",
    );
    const rowB = await repo.findBySourceAndExternalId(
      "blog",
      "https://hugobowne.substack.com/p/post-b",
    );
    expect(rowA?.title).toBe("Post A");
    expect(rowB?.title).toBe("Post B");
  });

  // EDGE: same externalId but different sourceType is NOT a duplicate
  // (the conflict target is the composite key).
  it("does not dedup when externalId matches but sourceType differs", async () => {
    const repo = createRawItemsRepo(getTestDb());

    // Contrived but legal: a Reddit post and a blog post happen to share
    // the same externalId string (unlikely for URL-based IDs, but the
    // dedup logic must be source-aware regardless).
    const blogItem = makeItem({
      sourceType: "blog",
      externalId: "shared-id",
      url: "https://blog.example/shared-id",
      title: "Blog item",
    });
    const redditItem = makeItem({
      sourceType: "reddit",
      externalId: "shared-id",
      url: "https://reddit.com/r/x/comments/shared-id",
      title: "Reddit item",
    });

    await repo.upsertItems([blogItem, redditItem]);

    const blogRow = await repo.findBySourceAndExternalId("blog", "shared-id");
    const redditRow = await repo.findBySourceAndExternalId("reddit", "shared-id");
    expect(blogRow?.title).toBe("Blog item");
    expect(redditRow?.title).toBe("Reddit item");
  });
});
