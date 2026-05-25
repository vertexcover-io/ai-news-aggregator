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
        imageUrl: null,
        metadata: { comments: [] },
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
        imageUrl: null,
        recap: null,
        enrichedSource: null,
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
        imageUrl: null,
        metadata: { comments: [] },
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
        imageUrl: null,
        metadata: { comments: [] },
      },
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 2, score: 0.6, rationale: "ok" }];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].content).toBeNull();
  });

  it("populates imageUrl from the DB row (REQ-013)", async () => {
    const repo = makeRepo([
      {
        id: 3,
        sourceType: "hn",
        title: "Image story",
        url: "https://example.com/3",
        author: null,
        publishedAt: null,
        engagement: { points: 10, commentCount: 0 },
        content: null,
        imageUrl: "https://example.com/img.jpg",
        metadata: { comments: [] },
      },
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 3, score: 0.7, rationale: "ok" }];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].imageUrl).toBe("https://example.com/img.jpg");
  });

  it("populates recap from raw_items metadata when present (REQ-014)", async () => {
    const repo = makeRepo([
      {
        id: 4,
        sourceType: "reddit",
        title: "Recap story",
        url: "https://example.com/4",
        author: "bob",
        publishedAt: null,
        engagement: { points: 20, commentCount: 5 },
        content: "Some body",
        imageUrl: null,
        metadata: {
          comments: [],
          recap: {
            title: "Recap title",
            summary: "A concise summary",
            bullets: ["Point 1", "Point 2"],
            bottomLine: "Key takeaway",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 4, score: 0.85, rationale: "interesting" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].recap).toEqual({
      title: "Recap title",
      summary: "A concise summary",
      bullets: ["Point 1", "Point 2"],
      bottomLine: "Key takeaway",
    });
  });

  it("sets recap to null when metadata has no recap (EDGE-010)", async () => {
    const repo = makeRepo([
      {
        id: 5,
        sourceType: "hn",
        title: "Old run story",
        url: "https://example.com/5",
        author: null,
        publishedAt: null,
        engagement: { points: 5, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: { comments: [] },
      },
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 5, score: 0.5, rationale: "legacy" }];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].recap).toBeNull();
  });

  it("REQ-004: ref.summary overrides raw recap summary", async () => {
    const repo = makeRepo([
      {
        id: 10,
        sourceType: "hn",
        title: "Override test",
        url: "https://example.com/10",
        author: null,
        publishedAt: null,
        engagement: { points: 10, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: {
          comments: [],
          recap: {
            title: "Recap title",
            summary: "original",
            bullets: ["b1"],
            bottomLine: "original bottom",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 10, score: 0.9, rationale: "ok", summary: "override" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].recap?.summary).toBe("override");
    // non-overridden fields fall back to raw
    expect(result[0].recap?.bullets).toEqual(["b1"]);
    expect(result[0].recap?.bottomLine).toBe("original bottom");
  });

  it("REQ-005: ref.imageUrl overrides raw imageUrl", async () => {
    const repo = makeRepo([
      {
        id: 11,
        sourceType: "hn",
        title: "Image override test",
        url: "https://example.com/11",
        author: null,
        publishedAt: null,
        engagement: { points: 10, commentCount: 0 },
        content: null,
        imageUrl: "https://b.com/old.png",
        metadata: { comments: [] },
      },
    ]);
    const refs: RankedItemRef[] = [
      {
        rawItemId: 11,
        score: 0.7,
        rationale: "ok",
        imageUrl: "https://a.com/img.png",
      },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].imageUrl).toBe("https://a.com/img.png");
  });

  it("EDGE-009: ref.summary=undefined falls back to raw recap summary", async () => {
    const repo = makeRepo([
      {
        id: 12,
        sourceType: "hn",
        title: "Fallback test",
        url: "https://example.com/12",
        author: null,
        publishedAt: null,
        engagement: { points: 5, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: {
          comments: [],
          recap: {
            title: "Recap title",
            summary: "raw summary",
            bullets: ["raw bullet"],
            bottomLine: "raw bottom",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 12, score: 0.6, rationale: "ok" }];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].recap?.summary).toBe("raw summary");
  });

  it("EDGE-010b: ref.summary='' (explicitly empty) overrides raw recap summary", async () => {
    const repo = makeRepo([
      {
        id: 13,
        sourceType: "hn",
        title: "Empty override test",
        url: "https://example.com/13",
        author: null,
        publishedAt: null,
        engagement: { points: 5, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: {
          comments: [],
          recap: {
            title: "Recap title",
            summary: "raw summary",
            bullets: ["raw bullet"],
            bottomLine: "raw bottom",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 13, score: 0.6, rationale: "ok", summary: "" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].recap?.summary).toBe("");
  });

  it("title precedence: ref.title overrides recap.title and row.title", async () => {
    const repo = makeRepo([
      {
        id: 20,
        sourceType: "hn",
        title: "source-title",
        url: "https://example.com/20",
        author: null,
        publishedAt: null,
        engagement: { points: 0, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: {
          comments: [],
          recap: {
            title: "ai-title",
            summary: "s",
            bullets: ["b"],
            bottomLine: "bl",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 20, score: 0.5, rationale: "ok", title: "operator-title" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].title).toBe("operator-title");
    expect(result[0].recap?.title).toBe("operator-title");
  });

  it("title precedence: recap.title is used when ref.title is absent", async () => {
    const repo = makeRepo([
      {
        id: 21,
        sourceType: "hn",
        title: "source-title",
        url: "https://example.com/21",
        author: null,
        publishedAt: null,
        engagement: { points: 0, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: {
          comments: [],
          recap: {
            title: "ai-title",
            summary: "s",
            bullets: ["b"],
            bottomLine: "bl",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 21, score: 0.5, rationale: "ok" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].title).toBe("ai-title");
  });

  it("title precedence: falls back to row.title when neither ref nor recap has a title (backcompat)", async () => {
    const repo = makeRepo([
      {
        id: 22,
        sourceType: "hn",
        title: "source-title",
        url: "https://example.com/22",
        author: null,
        publishedAt: null,
        engagement: { points: 0, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: { comments: [] },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 22, score: 0.5, rationale: "ok" },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].title).toBe("source-title");
  });

  it("EDGE-011: both ref.imageUrl and raw.imageUrl are null → hydrated imageUrl is null", async () => {
    const repo = makeRepo([
      {
        id: 14,
        sourceType: "hn",
        title: "Null image test",
        url: "https://example.com/14",
        author: null,
        publishedAt: null,
        engagement: { points: 5, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: { comments: [] },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 14, score: 0.5, rationale: "ok", imageUrl: null },
    ];
    const result = await hydrateRankedItems(repo, refs);
    expect(result[0].imageUrl).toBeNull();
  });
});
