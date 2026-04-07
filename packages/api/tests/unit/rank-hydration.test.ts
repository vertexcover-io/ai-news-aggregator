import { describe, it, expect, vi } from "vitest";
import type { AppDb, RankedItemRef } from "@newsletter/shared";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";

interface RawRow {
  id: number;
  sourceType: "hn" | "reddit";
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
}

function makeDb(rows: RawRow[]): AppDb {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as AppDb;
}

describe("hydrateRankedItems (REQ-012, REQ-013)", () => {
  it("returns empty array for empty refs (REQ-013)", async () => {
    const db = makeDb([]);
    const result = await hydrateRankedItems(db, []);
    expect(result).toEqual([]);
  });

  it("merges score and rationale onto raw item rows (REQ-012)", async () => {
    const publishedAt = new Date("2026-04-01T12:00:00Z");
    const db = makeDb([
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
    const result = await hydrateRankedItems(db, refs);
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
    const db = makeDb([]);
    const refs: RankedItemRef[] = [
      { rawItemId: 99, score: 0.5, rationale: "x" },
    ];
    const result = await hydrateRankedItems(db, refs);
    expect(result).toEqual([]);
  });
});
