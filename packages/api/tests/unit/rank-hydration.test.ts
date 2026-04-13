import { describe, it, expect, vi } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";

function makeRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve(rows)),
  };
}

describe("hydrateRankedItems (REQ-012, REQ-013)", () => {
  it("returns empty array for empty refs (REQ-013)", async () => {
    const repo = makeRepo([]);
    const result = await hydrateRankedItems(repo, []);
    expect(result).toEqual([]);
  });

  it("merges score and rationale onto raw item rows (REQ-012)", async () => {
    const publishedAt = new Date("2026-04-01T12:00:00Z");
    const repo = makeRepo([
      {
        id: 42,
        sourceType: "hn",
        title: "GPT-5 launch",
        url: "https://news.ycombinator.com/item?id=42",
        author: "sama",
        publishedAt,
        engagement: { points: 1000, commentCount: 250 },
        content: "Full article body text here",
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 42, score: 0.95, rationale: "high engagement & relevance" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result).toEqual([
      {
        id: 42,
        rawItemId: 42,
        title: "GPT-5 launch",
        url: "https://news.ycombinator.com/item?id=42",
        sourceType: "hn",
        author: "sama",
        publishedAt: "2026-04-01T12:00:00.000Z",
        engagement: { points: 1000, commentCount: 250 },
        score: 0.95,
        rationale: "high engagement & relevance",
        content: "Full article body text here",
      },
    ]);
  });

  it("skips refs whose raw item rows are missing", async () => {
    const repo = makeRepo([]);
    const refs: RankedItemRef[] = [
      { rawItemId: 99, score: 0.5, rationale: "x" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result).toEqual([]);
  });

  it("populates content from the row when it has a value (REQ-012)", async () => {
    const repo = makeRepo([
      {
        id: 1,
        sourceType: "hn",
        title: "Some title",
        url: "https://example.com",
        author: null,
        publishedAt: null,
        engagement: { points: 10, commentCount: 2 },
        content: "Article body content",
      },
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 1, score: 0.8, rationale: "relevant" }];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].content).toBe("Article body content");
  });

  it("sets content to null when row content is null (EDGE-006)", async () => {
    const repo = makeRepo([
      {
        id: 2,
        sourceType: "hn",
        title: "Title-only HN item",
        url: "https://example.com/2",
        author: null,
        publishedAt: null,
        engagement: { points: 5, commentCount: 0 },
        content: null,
      },
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 2, score: 0.6, rationale: "ok" }];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].content).toBeNull();
  });
});
