import { describe, it, expect, vi } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import type { RawItemRow, RawItemsRepo } from "@api/repositories/raw-items.js";

function makeRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve(rows)),
  };
}

function makeRow(overrides: Partial<RawItemRow> = {}): RawItemRow {
  return {
    id: 1,
    sourceType: "hn",
    title: "Test",
    url: "https://news.ycombinator.com/item?id=1",
    sourceUrl: null,
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    content: null,
    imageUrl: null,
    metadata: { comments: [] },
    ...overrides,
  };
}

describe("hydrateRankedItems — sourceIdentifier + preview (REQ-006)", () => {
  it("REQ-006: sets sourceIdentifier=news.ycombinator.com for hn", async () => {
    const repo = makeRepo([makeRow({ id: 1, sourceType: "hn" })]);
    const refs: RankedItemRef[] = [{ rawItemId: 1, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.sourceIdentifier).toBe("news.ycombinator.com");
  });

  it("REQ-006: sets sourceIdentifier=r/localllama for reddit (case-folded)", async () => {
    const repo = makeRepo([
      makeRow({
        id: 2,
        sourceType: "reddit",
        url: "https://reddit.com/r/LocalLLaMA/comments/abc",
      }),
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 2, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.sourceIdentifier).toBe("r/localllama");
  });

  it("REQ-006: sets sourceIdentifier=@karpathy for twitter", async () => {
    const repo = makeRepo([
      makeRow({
        id: 3,
        sourceType: "twitter",
        url: "https://x.com/karpathy/status/123",
        author: "karpathy",
        content: "Tweet text",
      }),
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 3, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.sourceIdentifier).toBe("@karpathy");
  });

  it("REQ-006: sets sourceIdentifier=openai.com for blog", async () => {
    const repo = makeRepo([
      makeRow({
        id: 4,
        sourceType: "blog",
        url: "https://openai.com/research/gpt5",
      }),
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 4, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.sourceIdentifier).toBe("openai.com");
  });

  it("sets preview.kind=tweet for twitter items", async () => {
    const repo = makeRepo([
      makeRow({
        id: 5,
        sourceType: "twitter",
        url: "https://x.com/user/status/1",
        content: "tweet content",
        author: "user",
        metadata: { comments: [] },
      }),
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 5, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.preview.kind).toBe("tweet");
  });

  it("sets preview.kind=none for hn (no enrichedLink)", async () => {
    const repo = makeRepo([
      makeRow({ id: 6, sourceType: "hn" }),
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 6, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.preview.kind).toBe("none");
  });

  it("sets preview.kind=link when enrichedLink.status=ok", async () => {
    const repo = makeRepo([
      makeRow({
        id: 7,
        sourceType: "blog",
        url: "https://openai.com/post",
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://openai.com/post",
            fetchedAt: "2026-05-01T10:00:00Z",
            status: "ok",
            title: "Some title",
          },
        },
      }),
    ]);
    const refs: RankedItemRef[] = [{ rawItemId: 7, score: 0.5, rationale: "" }];
    const [item] = await hydrateRankedItems(repo, refs);
    expect(item.preview.kind).toBe("link");
  });
});
