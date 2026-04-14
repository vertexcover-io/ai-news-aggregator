import { describe, it, expect, vi } from "vitest";

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

import {
  fetchRedditPost,
  parseRedditPostUrl,
} from "@pipeline/collectors/reddit-single.js";
import { UrlParseError } from "@pipeline/collectors/hn-single.js";

interface MockCall {
  url: string;
  init?: RequestInit;
}

interface MockResp {
  ok: boolean;
  status: number;
  body: unknown;
}

function makeFetch(
  responses: MockResp[],
): { fn: ReturnType<typeof vi.fn>; calls: MockCall[] } {
  const calls: MockCall[] = [];
  let i = 0;
  const fn = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    if (!r) return Promise.reject(new Error("no response"));
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
  return { fn, calls };
}

function postJson(): unknown {
  return [
    {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc123",
              title: "A Reddit Post",
              url: "https://example.com/x",
              permalink: "/r/test/comments/abc123/a_reddit_post/",
              author: "bob",
              selftext: "body",
              is_self: false,
              score: 10,
              num_comments: 3,
              created_utc: 1_700_000_000,
              stickied: false,
              subreddit: "test",
              thumbnail: "",
            },
          },
        ],
      },
    },
    {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t1",
            data: {
              id: "c1",
              author: "carol",
              body: "nice",
              created_utc: 1_700_000_100,
            },
          },
        ],
      },
    },
  ];
}

describe("parseRedditPostUrl", () => {
  it("parses a standard post URL", () => {
    const parsed = parseRedditPostUrl(
      "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/",
    );
    expect(parsed).toEqual({ subreddit: "test", postId: "abc123" });
  });

  it("returns null for a comment permalink", () => {
    expect(
      parseRedditPostUrl(
        "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/c1/",
      ),
    ).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(parseRedditPostUrl("https://example.com/nope")).toBeNull();
  });
});

describe("fetchRedditPost", () => {
  it("fetches a post and returns a RawItemInsert", async () => {
    const { fn, calls } = makeFetch([{ ok: true, status: 200, body: postJson() }]);
    const result = await fetchRedditPost(
      "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/",
      { fetchFn: fn },
    );
    expect(result.sourceType).toBe("reddit");
    expect(result.externalId).toBe("abc123");
    expect(result.title).toBe("A Reddit Post");
    expect(result.engagement).toEqual({ points: 10, commentCount: 3 });
    const firstCall = calls[0];
    expect(firstCall?.url).toMatch(/\.json$/);
    const headers = firstCall?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBeTruthy();
  });

  it("throws UrlParseError for a comment URL", async () => {
    const { fn } = makeFetch([]);
    await expect(
      fetchRedditPost(
        "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/c1/",
        { fetchFn: fn },
      ),
    ).rejects.toBeInstanceOf(UrlParseError);
  });

  it("throws UrlParseError for a malformed URL", async () => {
    const { fn } = makeFetch([]);
    await expect(
      fetchRedditPost("https://example.com/not-reddit", { fetchFn: fn }),
    ).rejects.toBeInstanceOf(UrlParseError);
  });

  it("forwards AbortSignal to the underlying fetch call", async () => {
    const { fn, calls } = makeFetch([
      { ok: true, status: 200, body: postJson() },
    ]);
    const ac = new AbortController();
    await fetchRedditPost(
      "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/",
      { fetchFn: fn, signal: ac.signal },
    );
    expect(calls[0]?.init?.signal).toBe(ac.signal);
  });
});
