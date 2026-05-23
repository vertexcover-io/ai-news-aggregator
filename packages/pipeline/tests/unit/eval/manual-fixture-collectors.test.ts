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

  it("when native (hn) collector throws, retries via web fetcher and skips enrichment", async () => {
    const dispatchFetch = vi.fn(
      (url: string, sourceType: AddPostSourceType): Promise<RawItemInsert> => {
        if (sourceType === "hn") {
          return Promise.reject(new Error("hn collector down"));
        }
        // web-fallback succeeds with real body content
        return Promise.resolve({
          sourceType: "blog",
          externalId: url,
          title: "Recovered title",
          url,
          content: "real article body from web fetcher",
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
      ["https://news.ycombinator.com/item?id=99999"],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    // First call: hn dispatch (rejects). Second call: web fallback (resolves).
    expect(dispatchFetch).toHaveBeenCalledTimes(2);
    expect(dispatchFetch.mock.calls[0][1]).toBe("hn");
    expect(dispatchFetch.mock.calls[1][1]).toBe("web");
    // Enrichment is no longer needed because the web fetcher populated content.
    expect(enrichRawItems).not.toHaveBeenCalled();
    expect(result.fixture.pool[0].sourceType).toBe("blog");
    expect(result.fixture.pool[0].content).toBe(
      "real article body from web fetcher",
    );
  });

  it("when both native AND web fallback throw, lands on synthetic web_search + enrichment", async () => {
    const dispatchFetch = vi.fn(() =>
      Promise.reject(new Error("everything is down")),
    );
    const enrichRawItems = vi.fn((items: RawItemInsert[]) =>
      Promise.resolve(items),
    );

    const result = await createManualFixture(
      ["https://news.ycombinator.com/item?id=99999"],
      {},
      { writeFixture, enrichRawItems, dispatchFetch },
    );

    // Two attempts: hn dispatch + web fallback, both reject.
    expect(dispatchFetch).toHaveBeenCalledTimes(2);
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
    // HN native throws -> web fallback succeeds -> sourceType is `web_search`
    // (from the mock's web-branch); reddit -> reddit; blog -> web_search.
    expect(bySourceType.filter((s) => s === "web_search")).toHaveLength(2);
    expect(bySourceType.filter((s) => s === "reddit")).toHaveLength(1);
    // No enrichment needed — all three items came back from dispatch with
    // content already populated.
    expect(enrichRawItems).not.toHaveBeenCalled();
    // HN URL was dispatched twice: once as "hn" (rejected), once as "web".
    const hnDispatchCalls = dispatchFetch.mock.calls.filter(
      (c) => c[0] === "https://news.ycombinator.com/item?id=42",
    );
    expect(hnDispatchCalls).toHaveLength(2);
    expect(hnDispatchCalls[0][1]).toBe("hn");
    expect(hnDispatchCalls[1][1]).toBe("web");
  });
});
