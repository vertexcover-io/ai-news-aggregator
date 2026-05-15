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
} from "@pipeline/collectors/reddit.js";
import { UrlParseError } from "@pipeline/collectors/hn.js";

interface MockCall {
  url: string;
  init?: RequestInit;
}

interface MockResp {
  ok: boolean;
  status: number;
  body: string;
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
      text: () => Promise.resolve(r.body),
    });
  });
  return { fn, calls };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function atomFeed(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  ${entries}
</feed>`;
}

function postRss(): string {
  const sourceUrl = "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/";
  const content = `<table><tr><td><div class="md"><p>body</p></div> submitted by <a href="https://www.reddit.com/user/bob">/u/bob</a><br/><span><a href="https://example.com/x">[link]</a></span> <span><a href="${sourceUrl}">[comments]</a></span></td></tr></table>`;
  return atomFeed(`
    <entry>
      <author><name>/u/bob</name></author>
      <content type="html">${escapeXml(content)}</content>
      <id>t3_abc123</id>
      <link href="${sourceUrl}" />
      <published>2023-11-14T22:13:20+00:00</published>
      <title>A Reddit Post</title>
    </entry>
    <entry>
      <author><name>/u/carol</name></author>
      <content type="html">${escapeXml('<div class="md"><p>nice</p></div>')}</content>
      <id>t1_c1</id>
      <published>2023-11-14T22:15:00+00:00</published>
      <title>nice</title>
    </entry>
  `);
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
    const { fn, calls } = makeFetch([{ ok: true, status: 200, body: postRss() }]);
    const result = await fetchRedditPost(
      "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/",
      { fetchFn: fn },
    );
    expect(result.sourceType).toBe("reddit");
    expect(result.externalId).toBe("abc123");
    expect(result.title).toBe("A Reddit Post");
    expect(result.url).toBe("https://example.com/x");
    expect(result.sourceUrl).toBe("https://www.reddit.com/r/test/comments/abc123/a_reddit_post/");
    expect(result.content).toBe("body");
    expect(result.engagement).toEqual({ points: 0, commentCount: 0 });
    expect(result.metadata).toEqual({ comments: [] });
    const firstCall = calls[0];
    expect(firstCall?.url).toMatch(/\.rss$/);
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
      { ok: true, status: 200, body: postRss() },
    ]);
    const ac = new AbortController();
    await fetchRedditPost(
      "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/",
      { fetchFn: fn, signal: ac.signal },
    );
    expect(calls[0]?.init?.signal).toBe(ac.signal);
  });
});
