import { describe, it, expect, vi } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RecapContent } from "@newsletter/shared";

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: () => undefined;
    warn: () => undefined;
    error: () => undefined;
    debug: () => undefined;
  } => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

import { hydrateAddedPost } from "@pipeline/services/add-post-helper.js";
import type { AddPostDeps } from "@pipeline/services/add-post-helper.js";

function validRecap(): RecapContent {
  return {
    summary: "a meaningful summary of the item",
    bullets: [
      "First analysis point on the item.",
      "Second analysis point about impact.",
      "Third analysis point on implications.",
    ],
    bottomLine: "Strategic takeaway sentence for readers.",
  };
}

function makeInsert(overrides: Partial<RawItemInsert> = {}): RawItemInsert {
  return {
    sourceType: "hn",
    externalId: "12345",
    title: "Some Post",
    url: "https://example.com/x",
    sourceUrl: "https://news.ycombinator.com/item?id=12345",
    author: "alice",
    content: "body",
    publishedAt: new Date("2026-04-13T00:00:00Z"),
    collectedAt: new Date(),
    engagement: { points: 10, commentCount: 2 },
    metadata: { comments: [] },
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(saved: { id: number } & RawItemInsert): {
  upsertItems: ReturnType<typeof vi.fn>;
  findBySourceAndExternalId: ReturnType<typeof vi.fn>;
  updateRecapData: ReturnType<typeof vi.fn>;
} {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
    findBySourceAndExternalId: vi.fn().mockResolvedValue(saved),
    updateRecapData: vi.fn().mockResolvedValue(undefined),
  };
}

describe("hydrateAddedPost", () => {
  it("composes fetch + upsert + recap and returns a RankedItem", async () => {
    const raw = makeInsert();
    const saved = { id: 99, ...raw, imageUrl: null };
    const recap = validRecap();
    const deps: AddPostDeps = {
      rawItemsRepo: makeRepo(saved),
      fetchHnPost: vi.fn().mockResolvedValue(raw),
      fetchRedditPost: vi.fn(),
      fetchWebPost: vi.fn(),
      generateRecap: vi.fn().mockResolvedValue(recap),
    };

    const result = await hydrateAddedPost(
      "https://news.ycombinator.com/item?id=12345",
      "hn",
      deps,
    );

    expect(result.title).toBe("Some Post");
    expect(result.rawItemId).toBe(99);
    expect(result.sourceType).toBe("hn");
    expect(result.recap).toEqual(recap);
  });

  it("sets metadata.addedInReview = true on the upserted row", async () => {
    const raw = makeInsert();
    const saved = { id: 99, ...raw, imageUrl: null };
    const upsertItems =
      vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined);
    const deps: AddPostDeps = {
      rawItemsRepo: {
        upsertItems,
        findBySourceAndExternalId: vi.fn().mockResolvedValue(saved),
        updateRecapData: vi.fn().mockResolvedValue(undefined),
      },
      fetchHnPost: vi.fn().mockResolvedValue(raw),
      fetchRedditPost: vi.fn(),
      fetchWebPost: vi.fn(),
      generateRecap: vi.fn().mockResolvedValue(validRecap()),
    };

    await hydrateAddedPost("https://news.ycombinator.com/item?id=12345", "hn", deps);

    const upserted = upsertItems.mock.calls[0]?.[0]?.[0];
    expect(upserted?.metadata).toBeDefined();
    const meta = upserted?.metadata as { addedInReview?: boolean };
    expect(meta.addedInReview).toBe(true);
  });

  it("calls updateRecapData with the saved row id and the generated recap", async () => {
    const raw = makeInsert();
    const saved = { id: 99, ...raw, imageUrl: null };
    const recap = validRecap();
    const updateRecapData = vi.fn().mockResolvedValue(undefined);
    const deps: AddPostDeps = {
      rawItemsRepo: {
        upsertItems: vi.fn().mockResolvedValue(undefined),
        findBySourceAndExternalId: vi.fn().mockResolvedValue(saved),
        updateRecapData,
      },
      fetchHnPost: vi.fn().mockResolvedValue(raw),
      fetchRedditPost: vi.fn(),
      fetchWebPost: vi.fn(),
      generateRecap: vi.fn().mockResolvedValue(recap),
    };

    await hydrateAddedPost("https://news.ycombinator.com/item?id=12345", "hn", deps);

    expect(updateRecapData).toHaveBeenCalledWith([{ id: 99, recap }]);
  });

  it("dispatches to fetchRedditPost for reddit source type", async () => {
    const raw = makeInsert({ sourceType: "reddit", externalId: "r1" });
    const saved = { id: 42, ...raw, imageUrl: null };
    const fetchRedditPost = vi.fn().mockResolvedValue(raw);
    const deps: AddPostDeps = {
      rawItemsRepo: makeRepo(saved),
      fetchHnPost: vi.fn(),
      fetchRedditPost,
      fetchWebPost: vi.fn(),
      generateRecap: vi.fn().mockResolvedValue(validRecap()),
    };

    await hydrateAddedPost(
      "https://www.reddit.com/r/test/comments/abc/foo/",
      "reddit",
      deps,
    );
    expect(fetchRedditPost).toHaveBeenCalledOnce();
  });

  it("dispatches to fetchWebPost for web source type", async () => {
    const raw = makeInsert({ sourceType: "blog", externalId: "https://example.com/p" });
    const saved = { id: 7, ...raw, imageUrl: null };
    const fetchWebPost = vi.fn().mockResolvedValue(raw);
    const deps: AddPostDeps = {
      rawItemsRepo: makeRepo(saved),
      fetchHnPost: vi.fn(),
      fetchRedditPost: vi.fn(),
      fetchWebPost,
      generateRecap: vi.fn().mockResolvedValue(validRecap()),
    };

    await hydrateAddedPost("https://example.com/p", "web", deps);
    expect(fetchWebPost).toHaveBeenCalledOnce();
  });

  describe("dispatchFetch forwards both signal and fetchFn (REQ-145 / EDGE-107)", () => {
    const cases: {
      sourceType: "hn" | "reddit" | "web";
      url: string;
      fetcherKey: "fetchHnPost" | "fetchRedditPost" | "fetchWebPost";
      insertType: "hn" | "reddit" | "blog";
    }[] = [
      {
        sourceType: "hn",
        url: "https://news.ycombinator.com/item?id=1",
        fetcherKey: "fetchHnPost",
        insertType: "hn",
      },
      {
        sourceType: "reddit",
        url: "https://www.reddit.com/r/test/comments/abc/foo/",
        fetcherKey: "fetchRedditPost",
        insertType: "reddit",
      },
      {
        sourceType: "web",
        url: "https://example.com/p",
        fetcherKey: "fetchWebPost",
        insertType: "blog",
      },
    ];

    for (const c of cases) {
      it(`forwards { signal, fetchFn } to ${c.fetcherKey}`, async () => {
        const raw = makeInsert({
          sourceType: c.insertType,
          externalId: "ext",
        });
        const saved = { id: 1, ...raw, imageUrl: null };
        const fetcher = vi.fn().mockResolvedValue(raw);
        const ac = new AbortController();
        const customFetch = vi.fn() as unknown as typeof fetch;
        const deps: AddPostDeps = {
          rawItemsRepo: makeRepo(saved),
          fetchHnPost: c.fetcherKey === "fetchHnPost" ? fetcher : vi.fn(),
          fetchRedditPost: c.fetcherKey === "fetchRedditPost" ? fetcher : vi.fn(),
          fetchWebPost: c.fetcherKey === "fetchWebPost" ? fetcher : vi.fn(),
          generateRecap: vi.fn().mockResolvedValue(validRecap()),
          signal: ac.signal,
          fetchFn: customFetch,
        };

        await hydrateAddedPost(c.url, c.sourceType, deps);

        expect(fetcher).toHaveBeenCalledOnce();
        const opts = fetcher.mock.calls[0]?.[1] as
          | { signal?: AbortSignal; fetchFn?: typeof fetch }
          | undefined;
        expect(opts?.signal).toBe(ac.signal);
        expect(opts?.fetchFn).toBe(customFetch);
      });
    }
  });
});
