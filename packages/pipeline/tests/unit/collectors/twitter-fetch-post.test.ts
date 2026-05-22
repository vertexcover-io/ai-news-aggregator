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
  parseTweetIdFromUrl,
  fetchTwitterPost,
  type FetchTwitterPostDeps,
} from "@pipeline/collectors/twitter/index.js";
import type { RettiwtRawTweet } from "@pipeline/collectors/twitter/clients/rettiwt.js";

function makeRawTweet(overrides: Partial<RettiwtRawTweet> = {}): RettiwtRawTweet {
  return {
    id: "20",
    fullText: "just setting up my twttr",
    createdAt: "2006-03-21T20:50:14.000Z",
    tweetBy: { userName: "jack" },
    likeCount: 100,
    retweetCount: 10,
    replyCount: 5,
    quoteCount: 2,
    media: [],
    entities: { urls: [] },
    ...overrides,
  };
}

describe("parseTweetIdFromUrl (REQ-001, REQ-003)", () => {
  const positiveCases: { url: string; id: string }[] = [
    { url: "https://x.com/jack/status/20", id: "20" },
    { url: "https://twitter.com/jack/status/20", id: "20" },
    { url: "https://www.x.com/jack/status/20", id: "20" },
    { url: "https://www.twitter.com/jack/status/20", id: "20" },
    { url: "https://mobile.twitter.com/jack/status/20", id: "20" },
    { url: "https://mobile.x.com/jack/status/20", id: "20" },
    { url: "https://x.com/i/status/123456", id: "123456" },
    { url: "https://x.com/jack/status/20?ref_src=abc", id: "20" },
    { url: "https://x.com/jack/status/20/photo/1", id: "20" },
    { url: "https://x.com/jack/status/20#m", id: "20" },
    { url: "HTTPS://X.COM/jack/status/20", id: "20" },
  ];

  for (const c of positiveCases) {
    it(`extracts ID ${c.id} from ${c.url}`, () => {
      expect(parseTweetIdFromUrl(c.url)).toBe(c.id);
    });
  }

  const negativeCases: string[] = [
    "https://x.com/jack",
    "https://x.com/jack/status/",
    "https://x.com/jack/status/notnumeric",
    "https://news.ycombinator.com/item?id=42",
    "https://reddit.com/r/test/comments/abc/foo",
    "https://example.com/post",
    "https://nitter.net/jack/status/20",
    "",
    "not-a-url",
  ];

  for (const url of negativeCases) {
    it(`returns null for ${url || "(empty)"}`, () => {
      expect(parseTweetIdFromUrl(url)).toBeNull();
    });
  }
});

describe("fetchTwitterPost", () => {
  it("REQ-005 happy path: returns RawItemInsert with sourceType=twitter, externalId, author", async () => {
    const fetchTweetById = vi.fn().mockResolvedValue(makeRawTweet());
    const deps: FetchTwitterPostDeps = {
      client: { fetchTweetById },
    };
    const item = await fetchTwitterPost("https://x.com/jack/status/20", deps);
    expect(fetchTweetById).toHaveBeenCalledWith("20", undefined);
    expect(item.sourceType).toBe("twitter");
    expect(item.externalId).toBe("20");
    expect(item.author).toBe("jack");
    expect(item.title).toContain("setting up my twttr");
    expect(item.url).toBe("https://x.com/jack/status/20");
    expect(item.engagement?.points).toBe(100);
  });

  it("REQ-005 truncates very long tweet text into title (≤80 chars)", async () => {
    const long = "x".repeat(300);
    const fetchTweetById = vi.fn().mockResolvedValue(makeRawTweet({ fullText: long }));
    const deps: FetchTwitterPostDeps = { client: { fetchTweetById } };
    const item = await fetchTwitterPost("https://x.com/jack/status/20", deps);
    expect(item.title.length).toBeLessThanOrEqual(80);
  });

  it("rejects a non-twitter URL", async () => {
    const deps: FetchTwitterPostDeps = {
      client: { fetchTweetById: vi.fn() },
    };
    await expect(
      fetchTwitterPost("https://example.com/post", deps),
    ).rejects.toThrow(/not a twitter status URL/);
  });

  it("REQ-006: throws 'Tweet not found' when client returns null", async () => {
    const deps: FetchTwitterPostDeps = {
      client: { fetchTweetById: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      fetchTwitterPost("https://x.com/jack/status/20", deps),
    ).rejects.toThrow(/Tweet not found, deleted, or protected: 20/);
  });

  it("REQ-006: throws 'Tweet not found' when client returns undefined", async () => {
    const deps: FetchTwitterPostDeps = {
      client: { fetchTweetById: vi.fn().mockResolvedValue(undefined) },
    };
    await expect(
      fetchTwitterPost("https://x.com/jack/status/20", deps),
    ).rejects.toThrow(/Tweet not found, deleted, or protected: 20/);
  });

  it("REQ-007: throws 'Twitter cookies not configured' when resolveCookie returns null and no client seam", async () => {
    const deps: FetchTwitterPostDeps = {
      resolveCookie: vi.fn().mockResolvedValue(null),
    };
    await expect(
      fetchTwitterPost("https://x.com/jack/status/20", deps),
    ).rejects.toThrow(/Twitter cookies not configured.*\/admin\/settings/);
  });

  it("REQ-009: throws 'Twitter auth failed' when constructor throws synchronously", async () => {
    const deps: FetchTwitterPostDeps = {
      resolveCookie: vi.fn().mockResolvedValue({ apiKey: "bogus", source: "env" }),
      rettiwtFactory: () => {
        throw new Error("Invalid authentication data");
      },
    };
    await expect(
      fetchTwitterPost("https://x.com/jack/status/20", deps),
    ).rejects.toThrow(/Twitter auth failed.*\/admin\/settings/);
  });

  it("REQ-009: throws 'Twitter auth failed' when tweet.details throws auth error after retry", async () => {
    const authErr = Object.assign(new Error("not authorized"), { status: 401 });
    const details = vi.fn().mockRejectedValue(authErr);
    const deps: FetchTwitterPostDeps = {
      resolveCookie: vi.fn().mockResolvedValue({ apiKey: "k", source: "env" }),
      rettiwtFactory: () => ({ tweet: { details } }),
      refreshCsrf: vi.fn().mockResolvedValue(null),
    };
    await expect(
      fetchTwitterPost("https://x.com/jack/status/20", deps),
    ).rejects.toThrow(/Twitter auth failed.*\/admin\/settings/);
  });

  it("REQ-008: refreshes CSRF and retries on CSRF-mismatch, then returns the tweet", async () => {
    const csrfErr = Object.assign(new Error("matching csrf cookie and header"), {
      status: 403,
      details: [{ message: "matching csrf cookie and header" }],
    });
    const details = vi
      .fn()
      .mockRejectedValueOnce(csrfErr)
      .mockResolvedValueOnce(makeRawTweet());
    const refreshCsrf = vi.fn().mockResolvedValue("rotated-key");
    let constructed = 0;
    const deps: FetchTwitterPostDeps = {
      resolveCookie: vi.fn().mockResolvedValue({ apiKey: "k1", source: "env" }),
      rettiwtFactory: (_apiKey) => {
        constructed += 1;
        return { tweet: { details } };
      },
      refreshCsrf,
    };
    const item = await fetchTwitterPost("https://x.com/jack/status/20", deps);
    expect(refreshCsrf).toHaveBeenCalledOnce();
    expect(details).toHaveBeenCalledTimes(2);
    expect(item.externalId).toBe("20");
    expect(constructed).toBeGreaterThanOrEqual(1);
  });

  it("REQ-010: calls resolveCookie on EVERY invocation (no memoisation)", async () => {
    const resolveCookie = vi
      .fn()
      .mockResolvedValueOnce({ apiKey: "key-1", source: "env" })
      .mockResolvedValueOnce({ apiKey: "key-2", source: "env" });
    const details = vi.fn().mockResolvedValue(makeRawTweet());
    const deps: FetchTwitterPostDeps = {
      resolveCookie,
      rettiwtFactory: () => ({ tweet: { details } }),
    };
    await fetchTwitterPost("https://x.com/jack/status/20", deps);
    await fetchTwitterPost("https://x.com/jack/status/20", deps);
    expect(resolveCookie).toHaveBeenCalledTimes(2);
  });

  it("REQ-012: pre-aborted signal causes rejection", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchTweetById = vi.fn().mockResolvedValue(makeRawTweet());
    const deps: FetchTwitterPostDeps = {
      client: { fetchTweetById },
      signal: ac.signal,
    };
    await expect(
      fetchTwitterPost("https://x.com/jack/status/20", deps),
    ).rejects.toThrow();
  });
});
