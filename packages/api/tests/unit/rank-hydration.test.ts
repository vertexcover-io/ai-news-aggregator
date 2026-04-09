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
});
