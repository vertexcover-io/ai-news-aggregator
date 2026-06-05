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

import { hydrateAddedPost, detectAddPostSourceType } from "@pipeline/services/add-post-helper.js";
import type { AddPostDeps } from "@pipeline/services/add-post-helper.js";

function validRecap(): RecapContent {
  return {
    title: "Test recap title",
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

describe("detectAddPostSourceType", () => {
  // REQ-002: HN item URL → "hn"
  it('REQ-002: returns "hn" for an HN item URL', () => {
    expect(detectAddPostSourceType("https://news.ycombinator.com/item?id=12345")).toBe("hn");
  });

  // EDGE-006: HN Algolia URL → "hn"
  it('EDGE-006: returns "hn" for an HN Algolia URL', () => {
    expect(detectAddPostSourceType("https://hn.algolia.com/#/story/comment/12345/67890")).toBe("hn");
  });

  // EDGE-001: HN URL with no id param → "web"
  it('EDGE-001: returns "web" for HN URL with no id param', () => {
    expect(detectAddPostSourceType("https://news.ycombinator.com/newest")).toBe("web");
  });

  // EDGE-002: HN URL with wrong param → "web"
  it('EDGE-002: returns "web" for malformed HN URL with wrong param', () => {
    expect(detectAddPostSourceType("https://news.ycombinator.com/item?foo=bar")).toBe("web");
  });

  // REQ-003: Reddit post URL → "reddit"
  it('REQ-003: returns "reddit" for a Reddit post URL', () => {
    expect(detectAddPostSourceType("https://www.reddit.com/r/MachineLearning/comments/abc123/title/")).toBe("reddit");
  });

  // EDGE-003: old.reddit.com → "reddit"
  it('EDGE-003: returns "reddit" for old.reddit.com post URL', () => {
    expect(detectAddPostSourceType("https://old.reddit.com/r/MachineLearning/comments/abc123/title/")).toBe("reddit");
  });

  // EDGE-004: Reddit subreddit URL (not a post) → "web"
  it('EDGE-004: returns "web" for Reddit subreddit URL without comments', () => {
    expect(detectAddPostSourceType("https://www.reddit.com/r/MachineLearning/")).toBe("web");
  });

  // EDGE-005: redd.it short URL → "web"
  it('EDGE-005: returns "web" for redd.it short URL', () => {
    expect(detectAddPostSourceType("https://redd.it/abc123")).toBe("web");
  });

  // EDGE-007: Reddit user URL → "web"
  it('EDGE-007: returns "web" for Reddit user URL', () => {
    expect(detectAddPostSourceType("https://www.reddit.com/user/foo")).toBe("web");
  });

  // EDGE-008: Empty string → "web"
  it('EDGE-008: returns "web" for empty string', () => {
    expect(detectAddPostSourceType("")).toBe("web");
  });

  // REQ-004: Arbitrary blog URL → "web"
  it('REQ-004: returns "web" for an arbitrary blog URL', () => {
    expect(detectAddPostSourceType("https://example.com/blog/post")).toBe("web");
  });

  // VS-0-5: Twitter/X URL detection
  it('VS-0-5: returns "twitter" for x.com /status/ URL', () => {
    expect(detectAddPostSourceType("https://x.com/jack/status/20")).toBe("twitter");
  });
  it('VS-0-5: returns "twitter" for twitter.com /status/ URL', () => {
    expect(detectAddPostSourceType("https://twitter.com/jack/status/20")).toBe(
      "twitter",
    );
  });
  it('VS-0-5: returns "twitter" for mobile.twitter.com /status/ URL', () => {
    expect(
      detectAddPostSourceType("https://mobile.twitter.com/jack/status/20"),
    ).toBe("twitter");
  });
  it('VS-0-5: returns "twitter" with trailing /photo/N', () => {
    expect(
      detectAddPostSourceType("https://x.com/jack/status/20/photo/1"),
    ).toBe("twitter");
  });
  it('VS-0-5: returns "twitter" with query string', () => {
    expect(
      detectAddPostSourceType("https://x.com/jack/status/20?ref_src=abc"),
    ).toBe("twitter");
  });
  it('VS-0-5: returns "web" for x.com profile URL (no /status/)', () => {
    expect(detectAddPostSourceType("https://x.com/jack")).toBe("web");
  });
  it('VS-0-5: returns "web" for nitter URL (not supported)', () => {
    expect(
      detectAddPostSourceType("https://nitter.net/jack/status/20"),
    ).toBe("web");
  });

});

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

    // AI-generated recap title takes precedence over source title
    expect(result.title).toBe("Test recap title");
    expect(result.rawItemId).toBe(99);
    expect(result.sourceType).toBe("hn");
    expect(result.recap).toEqual(recap);
    // Phase 1/2: added items carry a derived source identifier + a preview.
    expect(result.sourceIdentifier).toBe("news.ycombinator.com");
    // HN item with no enrichedLink → no preview payload.
    expect(result.preview.kind).toBe("none");
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

  it.each([
    {
      label: "reddit",
      sourceType: "reddit" as const,
      url: "https://www.reddit.com/r/test/comments/abc/foo/",
      fetcherKey: "fetchRedditPost" as const,
      insert: { sourceType: "reddit" as const, externalId: "r1" },
      id: 42,
    },
    {
      label: "twitter (REQ-004)",
      sourceType: "twitter" as const,
      url: "https://x.com/jack/status/20",
      fetcherKey: "fetchTwitterPost" as const,
      insert: { sourceType: "twitter" as const, externalId: "20" },
      id: 13,
    },
    {
      label: "web",
      sourceType: "web" as const,
      url: "https://example.com/p",
      fetcherKey: "fetchWebPost" as const,
      insert: { sourceType: "blog" as const, externalId: "https://example.com/p" },
      id: 7,
    },
  ])(
    "dispatches to $fetcherKey for $label source type",
    async ({ sourceType, url, fetcherKey, insert, id }) => {
      const raw = makeInsert(insert);
      const saved = { id, ...raw, imageUrl: null };
      const fetcher = vi.fn().mockResolvedValue(raw);
      const deps: AddPostDeps = {
        rawItemsRepo: makeRepo(saved),
        fetchHnPost: vi.fn(),
        fetchRedditPost: vi.fn(),
        fetchWebPost: vi.fn(),
        generateRecap: vi.fn().mockResolvedValue(validRecap()),
        [fetcherKey]: fetcher,
      };

      await hydrateAddedPost(url, sourceType, deps);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("VS-4: Twitter add-post passes enriched markdown (not tweet text) to generateRecap", async () => {
    const enrichedMarkdown = "# Full article from theverge.com\n\nLong enriched body text";
    const raw = makeInsert({
      sourceType: "twitter",
      externalId: "20",
      content: "tweet text here",
      metadata: {
        comments: [],
        enrichedLink: {
          url: "https://theverge.com/article",
          fetchedAt: "2026-05-25T00:00:00Z",
          status: "ok",
          markdown: enrichedMarkdown,
        },
      },
    });
    const saved = { id: 13, ...raw, imageUrl: null };
    const generateRecap = vi.fn().mockResolvedValue(validRecap());
    const deps: AddPostDeps = {
      rawItemsRepo: makeRepo(saved),
      fetchHnPost: vi.fn(),
      fetchRedditPost: vi.fn(),
      fetchWebPost: vi.fn(),
      fetchTwitterPost: vi.fn().mockResolvedValue(raw),
      generateRecap,
    };

    await hydrateAddedPost("https://x.com/jack/status/20", "twitter", deps);

    expect(generateRecap).toHaveBeenCalledOnce();
    const recapInput = generateRecap.mock.calls[0]?.[0] as { content: string | null };
    expect(recapInput.content).toBe(enrichedMarkdown);
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
