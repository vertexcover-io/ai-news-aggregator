/**
 * Pure URL parsing tests for parseRedditPostUrl.
 * REQ-011: parseRedditPostUrl is pure — no network, no actor calls.
 *
 * Note: fetchRedditPost behavior tests (with token / Apify runner) are in
 * reddit-apify.test.ts (REQ-010, REQ-021, EDGE-007, EDGE-010).
 */
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
  parseRedditPostUrl,
} from "@pipeline/collectors/reddit.js";
import { UrlParseError } from "@pipeline/collectors/hn.js";

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

describe("fetchRedditPost URL parse guard", () => {
  it("throws UrlParseError for a comment URL", async () => {
    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    await expect(
      fetchRedditPost(
        "https://www.reddit.com/r/test/comments/abc123/a_reddit_post/c1/",
      ),
    ).rejects.toBeInstanceOf(UrlParseError);
  });

  it("throws UrlParseError for a malformed URL", async () => {
    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    await expect(
      fetchRedditPost("https://example.com/not-reddit"),
    ).rejects.toBeInstanceOf(UrlParseError);
  });
});
