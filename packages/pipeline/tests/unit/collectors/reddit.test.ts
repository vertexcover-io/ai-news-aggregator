import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { RedditCollectConfig } from "@pipeline/types.js";

const warnSpy = vi.fn<[obj: unknown, msg?: string], undefined>();
vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: (obj: unknown, msg?: string) => undefined;
    warn: (obj: unknown, msg?: string) => undefined;
    error: (obj: unknown, msg?: string) => undefined;
    debug: (obj: unknown, msg?: string) => undefined;
  } => ({
    info: () => undefined,
    warn: (obj: unknown, msg?: string): undefined => {
      warnSpy(obj, msg);
      return undefined;
    },
    error: () => undefined,
    debug: () => undefined,
  }),
}));

type MockUpsertFn = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;
interface MockFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}
type MockFetchFn = ReturnType<
  typeof vi.fn<
    [url: string, init?: RequestInit],
    Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
  >
>;
type CollectRedditFn = (
  deps: { rawItemsRepo: RawItemsRepo & { upsertItems: MockUpsertFn }; fetchFn: MockFetchFn },
  config: RedditCollectConfig,
) => Promise<CollectorResult>;

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsertFn } {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

function createMockFetch(responses: readonly MockFetchResponse[]): MockFetchFn {
  let callIndex = 0;
  return vi.fn<
    [url: string, init?: RequestInit],
    Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
  >().mockImplementation(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    if (!response) {
      return Promise.reject(new Error("Network error"));
    }
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(response.body),
    });
  });
}

function rssResponse(body: string): MockFetchResponse {
  return { ok: true, status: 200, body };
}

function errorResponse(status: number): MockFetchResponse {
  return { ok: false, status, body: "<html>Error</html>" };
}

function atomFeed(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>MachineLearning</title>
  ${entries}
</feed>`;
}

// Use a date 1 day before "now" so sinceDays:7 always includes it without
// drifting out of the window as the suite ages. Per-test fixtures may still
// pass an explicit `published` ISO string when they need a specific value.
const RECENT_PUBLISHED_ISO = new Date(Date.now() - 86_400_000).toISOString();

function postEntry(options: {
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly published?: string;
  readonly sourceUrl?: string;
  readonly externalUrl?: string;
  readonly contentHtml?: string;
  readonly thumbnailUrl?: string;
}): string {
  const author = options.author ?? "ml_researcher";
  const published = options.published ?? RECENT_PUBLISHED_ISO;
  const sourceUrl =
    options.sourceUrl ??
    `https://www.reddit.com/r/MachineLearning/comments/${options.id}/slug/`;
  const externalUrl = options.externalUrl ?? "https://example.com/new-llm";
  const contentHtml =
    options.contentHtml ??
    `<table><tr><td><a href="${sourceUrl}"><img src="${options.thumbnailUrl ?? ""}" /></a></td><td> submitted by <a href="https://www.reddit.com/user/${author}">/u/${author}</a><br/><span><a href="${externalUrl}">[link]</a></span> <span><a href="${sourceUrl}">[comments]</a></span></td></tr></table>`;
  const thumbnail = options.thumbnailUrl
    ? `<media:thumbnail url="${options.thumbnailUrl}" />`
    : "";

  return `<entry>
    <author><name>/u/${author}</name><uri>https://www.reddit.com/user/${author}</uri></author>
    <content type="html">${escapeXml(contentHtml)}</content>
    <id>t3_${options.id}</id>
    ${thumbnail}
    <link href="${sourceUrl}" />
    <updated>${published}</updated>
    <published>${published}</published>
    <title>${escapeXml(options.title)}</title>
  </entry>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

describe("collectReddit RSS", () => {
  let collectReddit: CollectRedditFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Pin to a fixed instant so fixture dates stay inside sinceDays: 7 windows
    // regardless of when the suite is run. May-14 fixtures sit 2 days back.
    vi.setSystemTime(new Date("2026-05-16T00:00:00Z"));
    warnSpy.mockClear();
    const mod = await import("@pipeline/collectors/reddit.js");
    collectReddit = mod.collectReddit as CollectRedditFn;
  });

  it("builds Reddit RSS URLs for hot/new/top listings", async () => {
    const mockFetch = createMockFetch([
      rssResponse(atomFeed("")),
      rssResponse(atomFeed("")),
      rssResponse(atomFeed("")),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["HotSub", "NewSub", "TopSub"], sort: "hot", limit: 7, commentsPerItem: 0 },
    );
    await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["NewSub"], sort: "new", limit: 7, commentsPerItem: 0 },
    );
    await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["TopSub"], sort: "top", timeframe: "week", limit: 7, commentsPerItem: 0 },
    );

    expect(mockFetch.mock.calls[0][0]).toBe("https://www.reddit.com/r/HotSub/hot.rss?limit=7");
    expect(mockFetch.mock.calls[3][0]).toBe("https://www.reddit.com/r/NewSub/new.rss?limit=7");
    expect(mockFetch.mock.calls[4][0]).toBe("https://www.reddit.com/r/TopSub/top.rss?t=week&limit=7");
  });

  it("parses RSS listing entries into raw Reddit items", async () => {
    const thumbnail = "https://external-preview.redd.it/hero.jpg?width=640&amp;crop=smart";
    const listing = atomFeed(
      postEntry({
        id: "post001",
        title: "New open-source LLM beats GPT-4 on benchmarks",
        author: "ml_researcher",
        published: RECENT_PUBLISHED_ISO,
        externalUrl: "https://example.com/new-llm",
        thumbnailUrl: thumbnail,
      }),
    );
    const mockFetch = createMockFetch([rssResponse(listing)]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["MachineLearning"], sinceDays: 7, commentsPerItem: 0 },
    );

    expect(result.itemsFetched).toBe(1);
    expect(rawItemsRepo.upsertItems).toHaveBeenCalledTimes(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceType: "reddit",
      externalId: "post001",
      title: "New open-source LLM beats GPT-4 on benchmarks",
      url: "https://example.com/new-llm",
      sourceUrl: "https://www.reddit.com/r/MachineLearning/comments/post001/slug/",
      author: "ml_researcher",
      content: "",
      engagement: { points: 0, commentCount: 0 },
      imageUrl: "https://external-preview.redd.it/hero.jpg?width=640&crop=smart",
    });
    // A LINK post: url is the external article, but sourceUnit must be the
    // subreddit it was posted to — never the article's domain.
    expect(rows[0].metadata).toEqual({
      comments: [],
      sourceUnit: {
        identifier: "r/machinelearning",
        displayName: "r/machinelearning",
      },
    });
    expect(rows[0].publishedAt).toEqual(new Date(RECENT_PUBLISHED_ISO));
  });

  it("uses the embedded self-post body and falls back to the source URL for self posts", async () => {
    const sourceUrl = "https://www.reddit.com/r/MachineLearning/comments/post002/discussion/";
    const contentHtml = `<table><tr><td><div class="md"><p>I've been experimenting with local LLM setups.</p><p>Here are my findings.</p></div> submitted by <a href="https://www.reddit.com/user/ai_enthusiast">/u/ai_enthusiast</a><br/><span><a href="${sourceUrl}">[link]</a></span> <span><a href="${sourceUrl}">[comments]</a></span></td></tr></table>`;
    const mockFetch = createMockFetch([
      rssResponse(
        atomFeed(
          postEntry({
            id: "post002",
            title: "Discussion: What's the best local LLM setup in 2026?",
            author: "ai_enthusiast",
            sourceUrl,
            externalUrl: sourceUrl,
            contentHtml,
          }),
        ),
      ),
    ]);
    const rawItemsRepo = createMockRepo();

    await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["MachineLearning"], sinceDays: 7, commentsPerItem: 0 },
    );

    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].url).toBe(sourceUrl);
    expect(rows[0].content).toBe("I've been experimenting with local LLM setups. Here are my findings.");
  });

  it("ignores configured commentsPerItem: no per-post RSS comment fetch, empty comments stored", async () => {
    const listing = atomFeed(
      postEntry({
        id: "post001",
        title: "New open-source LLM beats GPT-4 on benchmarks",
      }),
    );
    const mockFetch = createMockFetch([rssResponse(listing)]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["MachineLearning"], commentsPerItem: 2, sinceDays: 7 },
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.commentsFetched).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows[0].metadata).toEqual({
      comments: [],
      sourceUnit: { identifier: "r/machinelearning", displayName: "r/machinelearning" },
    });
  });

  it("applies sinceDays, deduplicates posts, and reports per-subreddit unit results", async () => {
    const freshPost = postEntry({
      id: "fresh001",
      title: "Fresh post",
      published: new Date().toISOString(),
    });
    const oldPost = postEntry({
      id: "old001",
      title: "Old post",
      published: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });
    const mockFetch = createMockFetch([
      rssResponse(atomFeed(`${freshPost}${oldPost}`)),
      rssResponse(atomFeed(freshPost)),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["MachineLearning", "LocalLLaMA"], sinceDays: 7, commentsPerItem: 0 },
    );

    expect(result.itemsFetched).toBe(1);
    expect(result.unitResults).toHaveLength(2);
    expect(result.unitResults?.[0]).toMatchObject({ identifier: "r/machinelearning", status: "completed", itemsFetched: 2 });
    expect(result.unitResults?.[1]).toMatchObject({ identifier: "r/localllama", status: "completed", itemsFetched: 0 });
    const rows = rawItemsRepo.upsertItems.mock.calls[0][0];
    expect(rows.map((row) => row.externalId)).toEqual(["fresh001"]);
  });

  it("marks one subreddit as failed and continues collecting the rest", async () => {
    const mockFetch = createMockFetch([
      errorResponse(502),
      errorResponse(502),
      errorResponse(502),
      rssResponse(atomFeed(postEntry({ id: "good001", title: "Good post" }))),
    ]);
    const rawItemsRepo = createMockRepo();

    const result = await collectReddit(
      { rawItemsRepo, fetchFn: mockFetch },
      { subreddits: ["BadSub", "GoodSub"], commentsPerItem: 0, sinceDays: 7 },
    );

    expect(result.itemsFetched).toBe(1);
    const [bad, good] = result.unitResults ?? [];
    expect(bad).toMatchObject({ identifier: "r/badsub", status: "failed", itemsFetched: 0 });
    expect(good).toMatchObject({ identifier: "r/goodsub", status: "completed", itemsFetched: 1 });
  });
});
