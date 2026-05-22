import { describe, it, expect, vi } from "vitest";
import type { Fixture } from "@newsletter/shared/types/eval-ranking";
import type { RawItemInsert } from "@newsletter/shared/db";
import { createManualFixture } from "@pipeline/eval/manual-fixture.js";
import type { AddPostSourceType } from "@pipeline/services/add-post/dispatch.js";

function fakeHnItem(url: string): RawItemInsert {
  return {
    sourceType: "hn",
    externalId: "hn:12345",
    title: "Show HN: cool thing",
    url,
    content: "discussion body",
    publishedAt: new Date("2026-05-20T10:00:00.000Z"),
    engagement: { points: 142, commentCount: 37 },
    metadata: { comments: [] },
  };
}

function fakeRedditItem(url: string): RawItemInsert {
  return {
    sourceType: "reddit",
    externalId: "reddit:abc",
    title: "Reddit post title",
    url,
    content: "selftext",
    publishedAt: new Date("2026-05-20T11:00:00.000Z"),
    engagement: { points: 88, commentCount: 12 },
    metadata: { comments: [] },
  };
}

describe("createManualFixture — collector resolution", () => {
  const writeFixture = vi.fn((_f: Fixture) => Promise.resolve("/tmp/x.json"));

  it("routes an HN URL through the HN collector and preserves engagement", async () => {
    const dispatchFetch = vi.fn(
      (url: string, sourceType: AddPostSourceType) => {
        expect(sourceType).toBe("hn");
        return Promise.resolve(fakeHnItem(url));
      },
    );
    const enrichRawItems = vi.fn((items: RawItemInsert[]) =>
      Promise.resolve(items),
    );

    const result = await createManualFixture(
      ["https://news.ycombinator.com/item?id=12345"],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    expect(dispatchFetch).toHaveBeenCalledOnce();
    expect(enrichRawItems).not.toHaveBeenCalled();
    expect(result.fixture.pool[0].sourceType).toBe("hn");
    expect(result.fixture.pool[0].engagement.points).toBe(142);
  });

  it("routes a Reddit URL through the Reddit collector", async () => {
    const dispatchFetch = vi.fn(
      (url: string, sourceType: AddPostSourceType) => {
        expect(sourceType).toBe("reddit");
        return Promise.resolve(fakeRedditItem(url));
      },
    );
    const enrichRawItems = vi.fn((items: RawItemInsert[]) =>
      Promise.resolve(items),
    );

    const result = await createManualFixture(
      ["https://www.reddit.com/r/MachineLearning/comments/abc/foo/"],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    expect(dispatchFetch).toHaveBeenCalledOnce();
    expect(result.fixture.pool[0].sourceType).toBe("reddit");
  });

  it("falls back to web_search synthetic + enrichment when collector throws", async () => {
    const dispatchFetch = vi.fn(() =>
      Promise.reject(new Error("hn collector down")),
    );
    const enrichRawItems = vi.fn((items: RawItemInsert[]) =>
      Promise.resolve(items),
    );

    const result = await createManualFixture(
      ["https://news.ycombinator.com/item?id=99999"],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    expect(dispatchFetch).toHaveBeenCalledOnce();
    expect(enrichRawItems).toHaveBeenCalledOnce();
    expect(result.fixture.pool[0].sourceType).toBe("web_search");
  });

  it("classifies a generic blog URL as web (web_search after fallback)", async () => {
    const dispatchFetch = vi.fn(
      (url: string, sourceType: AddPostSourceType): Promise<RawItemInsert> => {
        expect(sourceType).toBe("web");
        return Promise.resolve({
          sourceType: "web_search",
          externalId: `web:${url}`,
          title: "Blog title",
          url,
          content: "blog body",
          publishedAt: null,
          engagement: { points: 0, commentCount: 0 },
          metadata: { comments: [] },
        });
      },
    );
    const enrichRawItems = vi.fn((items: RawItemInsert[]) =>
      Promise.resolve(items),
    );

    const result = await createManualFixture(
      ["https://anthropic.com/research/foo"],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    expect(result.fixture.pool[0].sourceType).toBe("web_search");
  });

  it("mixed batch: failing HN falls back, good Reddit + blog land correctly", async () => {
    const dispatchFetch = vi.fn(
      (url: string, sourceType: AddPostSourceType): Promise<RawItemInsert> => {
        if (sourceType === "hn") {
          return Promise.reject(new Error("hn 500"));
        }
        if (sourceType === "reddit") {
          return Promise.resolve(fakeRedditItem(url));
        }
        return Promise.resolve({
          sourceType: "web_search",
          externalId: `web:${url}`,
          title: "Blog title",
          url,
          content: "blog body",
          publishedAt: null,
          engagement: { points: 0, commentCount: 0 },
          metadata: { comments: [] },
        });
      },
    );
    const enrichRawItems = vi.fn((items: RawItemInsert[]) =>
      Promise.resolve(items),
    );

    const result = await createManualFixture(
      [
        "https://news.ycombinator.com/item?id=42",
        "https://www.reddit.com/r/MachineLearning/comments/zzz/bar/",
        "https://anthropic.com/research/baz",
      ],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    expect(result.fixture.pool).toHaveLength(3);
    const bySourceType = result.fixture.pool.map((p) => p.sourceType);
    // HN URL fell back -> web_search; reddit -> reddit; blog -> web_search
    expect(bySourceType.filter((s) => s === "web_search")).toHaveLength(2);
    expect(bySourceType.filter((s) => s === "reddit")).toHaveLength(1);
    // enrichment runs only on the one failing HN URL (blog already came back
    // from dispatch with web_search content)
    expect(enrichRawItems).toHaveBeenCalledOnce();
    const enrichedItems = enrichRawItems.mock.calls[0][0];
    expect(enrichedItems).toHaveLength(1);
    expect(enrichedItems[0].url).toBe(
      "https://news.ycombinator.com/item?id=42",
    );
  });
});
