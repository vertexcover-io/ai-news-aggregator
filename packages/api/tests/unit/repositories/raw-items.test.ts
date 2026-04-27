import { describe, it, expect, vi } from "vitest";
import type { AppDb } from "@newsletter/shared/db";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";

interface FakeRow {
  id: number;
  sourceType: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  imageUrl: string | null;
  metadata: { comments: [] };
}

function createFakeDb(rows: FakeRow[]): Pick<AppDb, "select"> {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  } as unknown as Pick<AppDb, "select">;
}

describe("createRawItemsRepo.findByIds", () => {
  it("returns [] without calling db.select when ids is empty", async () => {
    const db = createFakeDb([]);
    const selectSpy = vi.mocked(db.select);
    const repo = createRawItemsRepo(db);

    const result = await repo.findByIds([]);

    expect(result).toEqual([]);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("returns the mapped rows when db returns results", async () => {
    const engagement = { points: 100, commentCount: 10 };
    const metadata = { comments: [] as [] };
    const publishedAt = new Date("2026-04-01T00:00:00Z");
    const rows: FakeRow[] = [
      {
        id: 1,
        sourceType: "hn",
        title: "First Story",
        url: "https://example.com/1",
        author: "alice",
        publishedAt,
        engagement,
        content: "some article",
        imageUrl: "https://example.com/img.png",
        metadata,
      },
      {
        id: 2,
        sourceType: "reddit",
        title: "Second Story",
        url: "https://example.com/2",
        author: null,
        publishedAt: null,
        engagement: { points: 0, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: { comments: [] as [] },
      },
    ];
    const db = createFakeDb(rows);
    const repo = createRawItemsRepo(db);

    const result = await repo.findByIds([1, 2]);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[0].sourceType).toBe("hn");
    expect(result[0].title).toBe("First Story");
    expect(result[0].url).toBe("https://example.com/1");
    expect(result[0].author).toBe("alice");
    expect(result[0].publishedAt).toEqual(publishedAt);
    expect(result[0].engagement).toEqual(engagement);
    expect(result[0].content).toBe("some article");
    expect(result[0].imageUrl).toBe("https://example.com/img.png");
    expect(result[0].metadata).toEqual(metadata);

    expect(result[1].id).toBe(2);
    expect(result[1].sourceType).toBe("reddit");
    expect(result[1].author).toBeNull();
    expect(result[1].publishedAt).toBeNull();
    expect(result[1].imageUrl).toBeNull();
  });
});
