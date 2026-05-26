import { describe, it, expect } from "vitest";
import { tweetToRawItem } from "@pipeline/collectors/twitter/map.js";
import type { NormalizedTweet } from "@pipeline/collectors/twitter/types.js";

function makeTweet(overrides: Partial<NormalizedTweet> = {}): NormalizedTweet {
  return {
    id: "1234567890",
    authorHandle: "sama",
    fullText: "hello world",
    createdAt: "2026-05-01T12:00:00.000Z",
    eventCreatedAt: "2026-05-01T12:00:00.000Z",
    url: "https://x.com/sama/status/1234567890",
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    photoUrls: [],
    isRetweet: false,
    isQuote: false,
    ...overrides,
  };
}

describe("tweetToRawItem", () => {
  describe("REQ-005, REQ-010 — externalId and url", () => {
    it("uses tweet id as externalId and the provided url", () => {
      const t = makeTweet({ id: "9999", url: "https://x.com/sama/status/9999" });
      const item = tweetToRawItem(t);
      expect(item.externalId).toBe("9999");
      expect(item.url).toBe("https://x.com/sama/status/9999");
      expect(item.sourceType).toBe("twitter");
    });
  });

  describe("sourceUnit stamping", () => {
    it("stamps the provided collection unit onto metadata", () => {
      const t = makeTweet();
      const item = tweetToRawItem(t, {
        identifier: "list:158",
        displayName: "Twitter list 158",
      });
      expect(item.metadata?.sourceUnit).toEqual({
        identifier: "list:158",
        displayName: "Twitter list 158",
      });
    });

    it("omits sourceUnit when none is provided", () => {
      const item = tweetToRawItem(makeTweet());
      expect(item.metadata?.sourceUnit).toBeUndefined();
    });

    it("keeps both quotedTweet and sourceUnit when both apply", () => {
      const t = makeTweet({
        quotedTweet: {
          id: "q1",
          authorHandle: "dwarkesh_sp",
          fullText: "quoted",
          url: "https://x.com/dwarkesh_sp/status/q1",
          createdAt: "2026-05-01T11:00:00.000Z",
          photoUrls: [],
        },
      });
      const item = tweetToRawItem(t, {
        identifier: "user:sama",
        displayName: "@sama",
      });
      expect(item.metadata?.sourceUnit).toEqual({
        identifier: "user:sama",
        displayName: "@sama",
      });
      expect(item.metadata?.quotedTweet?.id).toBe("q1");
    });
  });

  describe("REQ-006 — engagement", () => {
    it("sums retweet + reply + quote into commentCount; points = likeCount", () => {
      const t = makeTweet({ likeCount: 10, retweetCount: 3, replyCount: 5, quoteCount: 7 });
      const item = tweetToRawItem(t);
      expect(item.engagement).toEqual({ points: 10, commentCount: 15 });
    });

    it("EDGE-005 — zeroed counters produce a complete object", () => {
      const t = makeTweet();
      const item = tweetToRawItem(t);
      expect(item.engagement).toEqual({ points: 0, commentCount: 0 });
    });
  });

  describe("REQ-007 — imageUrl", () => {
    it("EDGE-001: empty photoUrls → null", () => {
      const item = tweetToRawItem(makeTweet({ photoUrls: [] }));
      expect(item.imageUrl).toBeNull();
    });

    it("EDGE-002: video-only (denormalizer drops videos) → photoUrls empty → null", () => {
      const item = tweetToRawItem(makeTweet({ photoUrls: [] }));
      expect(item.imageUrl).toBeNull();
    });

    it("EDGE-003: multiple photos → first url", () => {
      const item = tweetToRawItem(
        makeTweet({ photoUrls: ["https://pbs.twimg.com/a.jpg", "https://pbs.twimg.com/b.jpg"] }),
      );
      expect(item.imageUrl).toBe("https://pbs.twimg.com/a.jpg");
    });
  });

  describe("REQ-008 / EDGE-012 — retweets", () => {
    it("uses inner-tweet fields (denormalizer already applied)", () => {
      const t = makeTweet({
        id: "inner-id",
        authorHandle: "originalAuthor",
        fullText: "original tweet body",
        url: "https://x.com/originalAuthor/status/inner-id",
        isRetweet: true,
      });
      const item = tweetToRawItem(t);
      expect(item.externalId).toBe("inner-id");
      expect(item.author).toBe("originalAuthor");
      expect(item.content).toBe("original tweet body");
    });
  });

  describe("REQ-009 — quote tweets", () => {
    // VS-4: updated — quotedTweet is now surfaced in content
    it("appends `Quoting @handle: …` to content when quotedTweet is set", () => {
      const t = makeTweet({
        fullText: "my hot take",
        isQuote: true,
        quotedTweet: {
          id: "quoted-id",
          authorHandle: "originalAuthor",
          fullText: "original tweet body",
          url: "https://x.com/originalAuthor/status/quoted-id",
          createdAt: "2026-04-30T10:00:00.000Z",
          photoUrls: [],
        },
      });
      const item = tweetToRawItem(t);
      expect(item.content).toBe("my hot take\n\nQuoting @originalAuthor: original tweet body");
      // title is still derived from outer text only
      expect(item.title).toBe("my hot take");
    });
  });

  describe("VS-5 — metadata.quotedTweet", () => {
    it("writes quotedTweet to metadata alongside comments", () => {
      const quoted = {
        id: "quoted-id",
        authorHandle: "originalAuthor",
        fullText: "original tweet body",
        url: "https://x.com/originalAuthor/status/quoted-id",
        createdAt: "2026-04-30T10:00:00.000Z",
        photoUrls: ["https://pbs/q.jpg"],
      };
      const t = makeTweet({ isQuote: true, quotedTweet: quoted });
      const item = tweetToRawItem(t);
      expect(item.metadata).toEqual({ comments: [], quotedTweet: quoted });
    });
  });

  describe("VS-6 — plain tweet unchanged", () => {
    it("leaves content + metadata unchanged when quotedTweet is undefined", () => {
      const t = makeTweet({ fullText: "plain tweet text" });
      const item = tweetToRawItem(t);
      expect(item.content).toBe("plain tweet text");
      expect(item.metadata).toEqual({ comments: [] });
      expect(item.metadata.quotedTweet).toBeUndefined();
    });
  });

  describe("REQ-011 — title truncation", () => {
    it("short text passes through", () => {
      const item = tweetToRawItem(makeTweet({ fullText: "short tweet" }));
      expect(item.title).toBe("short tweet");
    });

    it("exactly 80 chars: no ellipsis", () => {
      const text = "a".repeat(80);
      const item = tweetToRawItem(makeTweet({ fullText: text }));
      expect(item.title).toBe(text);
      expect(item.title?.length).toBe(80);
    });

    it("81 chars: ellipsis appended after first 79 chars", () => {
      const text = "a".repeat(81);
      const item = tweetToRawItem(makeTweet({ fullText: text }));
      expect(item.title).toBe(`${"a".repeat(79)}…`);
      expect(item.title?.length).toBe(80);
    });

    it("collapses newlines and runs of whitespace into single spaces", () => {
      const text = "first line\nsecond   line\twith\ttabs";
      const item = tweetToRawItem(makeTweet({ fullText: text }));
      expect(item.title).toBe("first line second line with tabs");
    });
  });

  describe("REQ-012 — content full-text round-trip", () => {
    it("preserves a 777-char fullText", () => {
      const long = "x".repeat(777);
      const item = tweetToRawItem(makeTweet({ fullText: long }));
      expect(item.content).toBe(long);
      expect(item.content?.length).toBe(777);
    });
  });

  describe("REQ-013 — metadata.comments", () => {
    it("is an empty array", () => {
      const item = tweetToRawItem(makeTweet());
      expect(item.metadata).toEqual({ comments: [] });
    });
  });

  describe("publishedAt", () => {
    it("parses createdAt ISO string into a Date", () => {
      const item = tweetToRawItem(makeTweet({ createdAt: "2026-05-01T12:00:00.000Z" }));
      expect(item.publishedAt).toBeInstanceOf(Date);
      expect((item.publishedAt as Date).toISOString()).toBe("2026-05-01T12:00:00.000Z");
    });
  });

  describe("author", () => {
    it("uses authorHandle from NormalizedTweet", () => {
      const item = tweetToRawItem(makeTweet({ authorHandle: "jack" }));
      expect(item.author).toBe("jack");
    });
  });
});
