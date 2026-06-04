import { describe, it, expect, vi } from "vitest";
import { MediaType } from "rettiwt-api";
import {
  createRettiwtClient,
  type RettiwtCursoredPage,
  type RettiwtFacade,
  type RettiwtRawTweet,
} from "@pipeline/collectors/twitter/clients/rettiwt.js";

function makeFakeTweet(overrides: Partial<RettiwtRawTweet> = {}): RettiwtRawTweet {
  return {
    id: "100",
    fullText: "hello",
    createdAt: "2026-05-01T00:00:00.000Z",
    tweetBy: { userName: "alice" },
    likeCount: 1,
    retweetCount: 2,
    replyCount: 3,
    quoteCount: 4,
    ...overrides,
  };
}

type CursorShape = string | { value: string } | null;

function makeCursored(tweets: RettiwtRawTweet[], next: CursorShape): RettiwtCursoredPage {
  return { list: tweets, next };
}

interface RettiwtStub extends RettiwtFacade {
  list: { tweets: ReturnType<typeof vi.fn> };
  user: { timeline: ReturnType<typeof vi.fn> };
}

function makeRettiwtStub(): RettiwtStub {
  return {
    list: { tweets: vi.fn() },
    user: { timeline: vi.fn() },
  };
}

function makeCsrfMismatchError(): Error & {
  readonly status: number;
  readonly details: readonly { readonly code: number; readonly message: string }[];
} {
  return Object.assign(new Error("Request failed with status code 403"), {
    status: 403,
    details: [
      {
        code: 353,
        message: "This request requires a matching csrf cookie and header.",
      },
    ],
  });
}

describe("createRettiwtClient", () => {
  describe("fetchListTweets", () => {
    it("denormalizes a list page and returns the next cursor (string form)", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(
        makeCursored(
          [
            makeFakeTweet({
              id: "1",
              fullText: "first tweet",
              tweetBy: { userName: "alice" },
              media: [
                { type: MediaType.PHOTO, url: "https://pbs/a.jpg" },
                { type: MediaType.VIDEO, url: "https://video/x.mp4" },
              ],
            }),
            makeFakeTweet({ id: "2", fullText: "second tweet", tweetBy: { userName: "bob" } }),
          ],
          "next-cursor-abc",
        ),
      );

      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("listId-9");

      expect(stub.list.tweets).toHaveBeenCalledWith("listId-9", undefined, undefined);
      expect(result.tweets).toHaveLength(2);
      expect(result.tweets[0]).toMatchObject({
        id: "1",
        authorHandle: "alice",
        fullText: "first tweet",
        url: "https://x.com/alice/status/1",
        likeCount: 1,
        retweetCount: 2,
        replyCount: 3,
        quoteCount: 4,
        photoUrls: ["https://pbs/a.jpg"],
        isRetweet: false,
        isQuote: false,
      });
      expect(result.nextCursor).toBe("next-cursor-abc");
    });

    it("denormalizes a retweet using inner-tweet fields", async () => {
      const stub = makeRettiwtStub();
      const inner = makeFakeTweet({
        id: "inner-id",
        fullText: "original body",
        tweetBy: { userName: "original" },
        likeCount: 100,
        retweetCount: 50,
        replyCount: 5,
        quoteCount: 1,
      });
      const outer = makeFakeTweet({
        id: "outer-id",
        fullText: "RT @original: original body",
        tweetBy: { userName: "rter" },
        retweetedTweet: inner,
      });
      stub.list.tweets.mockResolvedValueOnce(makeCursored([outer], null));

      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("L");

      expect(result.tweets).toHaveLength(1);
      expect(result.tweets[0]).toMatchObject({
        id: "inner-id",
        authorHandle: "original",
        fullText: "original body",
        url: "https://x.com/original/status/inner-id",
        likeCount: 100,
        retweetCount: 50,
        replyCount: 5,
        quoteCount: 1,
        isRetweet: true,
      });
      expect(result.nextCursor).toBeNull();
    });

    it("passes maxTweets and cursor through to the underlying client", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(makeCursored([], null));
      const client = createRettiwtClient({ rettiwt: stub });

      await client.fetchListTweets("L", { maxTweets: 50, cursor: "cursor-xyz" });

      expect(stub.list.tweets).toHaveBeenCalledWith("L", 50, "cursor-xyz");
    });

    it("extracts cursor from { value } object form", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(makeCursored([], { value: "obj-cursor" }));
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchListTweets("L");

      expect(result.nextCursor).toBe("obj-cursor");
    });

    it("treats empty-string cursor as null", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(makeCursored([], ""));
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchListTweets("L");

      expect(result.nextCursor).toBeNull();
    });

    it("refreshes csrf auth and retries once when X returns code 353", async () => {
      const stub = makeRettiwtStub();
      const refreshCsrfToken = vi.fn(() => Promise.resolve(true));
      stub.list.tweets
        .mockRejectedValueOnce(makeCsrfMismatchError())
        .mockResolvedValueOnce(makeCursored([makeFakeTweet({ id: "after-refresh" })], null));
      const client = createRettiwtClient({
        rettiwt: stub,
        auth: { refreshCsrfToken },
      });

      const result = await client.fetchListTweets("L", {
        maxTweets: 10,
        cursor: "cursor-before",
      });

      expect(refreshCsrfToken).toHaveBeenCalledOnce();
      expect(stub.list.tweets).toHaveBeenCalledTimes(2);
      expect(stub.list.tweets).toHaveBeenNthCalledWith(
        2,
        "L",
        10,
        "cursor-before",
      );
      expect(result.tweets[0].id).toBe("after-refresh");
    });

    it("does not retry non-csrf 403 errors", async () => {
      const stub = makeRettiwtStub();
      const refreshCsrfToken = vi.fn(() => Promise.resolve(true));
      const forbidden = Object.assign(new Error("Request failed with status code 403"), {
        status: 403,
        details: [{ code: 88, message: "Rate limit exceeded." }],
      });
      stub.list.tweets.mockRejectedValueOnce(forbidden);
      const client = createRettiwtClient({
        rettiwt: stub,
        auth: { refreshCsrfToken },
      });

      await expect(client.fetchListTweets("L")).rejects.toBe(forbidden);

      expect(refreshCsrfToken).not.toHaveBeenCalled();
      expect(stub.list.tweets).toHaveBeenCalledOnce();
    });
  });

  describe("fetchUserTimeline", () => {
    it("denormalizes user timeline and surfaces nextCursor null when next is null", async () => {
      const stub = makeRettiwtStub();
      stub.user.timeline.mockResolvedValueOnce(
        makeCursored(
          [makeFakeTweet({ id: "u1", tweetBy: { userName: "sama" }, fullText: "ai is real" })],
          null,
        ),
      );
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchUserTimeline("1605", { maxTweets: 20 });

      expect(stub.user.timeline).toHaveBeenCalledWith("1605", 20, undefined);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets[0].authorHandle).toBe("sama");
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("entities.urls → externalUrl", () => {
    it("populates externalUrl with the first non-platform URL", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(
        makeCursored(
          [
            makeFakeTweet({
              id: "x1",
              entities: {
                urls: [
                  "https://t.co/abc",
                  "https://x.com/foo/status/1",
                  "https://arxiv.org/abs/2401.00001",
                  "https://example.com/other",
                ],
              },
            }),
          ],
          null,
        ),
      );
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchListTweets("L");

      expect(result.tweets[0].externalUrl).toBe("https://arxiv.org/abs/2401.00001");
    });

    it("leaves externalUrl undefined when entities.urls is missing", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(
        makeCursored([makeFakeTweet({ id: "x2" })], null),
      );
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchListTweets("L");

      expect(result.tweets[0].externalUrl).toBeUndefined();
    });

    it("leaves externalUrl undefined when all entity URLs are same-platform", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(
        makeCursored(
          [
            makeFakeTweet({
              id: "x3",
              entities: {
                urls: ["https://t.co/x", "https://twitter.com/a/status/1"],
              },
            }),
          ],
          null,
        ),
      );
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchListTweets("L");

      expect(result.tweets[0].externalUrl).toBeUndefined();
    });

    it("uses the inner (retweeted) tweet's entities for retweets", async () => {
      const stub = makeRettiwtStub();
      const inner = makeFakeTweet({
        id: "inner",
        tweetBy: { userName: "orig" },
        entities: { urls: ["https://arxiv.org/abs/9999"] },
      });
      const outer = makeFakeTweet({
        id: "outer",
        tweetBy: { userName: "rt" },
        retweetedTweet: inner,
      });
      stub.list.tweets.mockResolvedValueOnce(makeCursored([outer], null));
      const client = createRettiwtClient({ rettiwt: stub });

      const result = await client.fetchListTweets("L");

      expect(result.tweets[0].externalUrl).toBe("https://arxiv.org/abs/9999");
    });
  });

  describe("quoted tweet extraction", () => {
    // VS-1: direct quote
    it("extracts quoted into quotedTweet when outer has `quoted`", async () => {
      const stub = makeRettiwtStub();
      const quotedInner = makeFakeTweet({
        id: "quoted-id",
        fullText: "original tweet body",
        tweetBy: { userName: "originalAuthor" },
        createdAt: "2026-04-30T10:00:00.000Z",
        media: [
          { type: MediaType.PHOTO, url: "https://pbs/q.jpg" },
          { type: MediaType.VIDEO, url: "https://video/q.mp4" },
        ],
      });
      const outer = makeFakeTweet({
        id: "outer-id",
        fullText: "my hot take",
        tweetBy: { userName: "commenter" },
        quoted: quotedInner,
      });
      stub.list.tweets.mockResolvedValueOnce(makeCursored([outer], null));

      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("L");

      expect(result.tweets[0].quotedTweet).toEqual({
        id: "quoted-id",
        authorHandle: "originalAuthor",
        fullText: "original tweet body",
        url: "https://x.com/originalAuthor/status/quoted-id",
        createdAt: "2026-04-30T10:00:00.000Z",
        photoUrls: ["https://pbs/q.jpg"],
      });
      // VS-7: isQuote is true (outer has `quoted`), isRetweet is false
      expect(result.tweets[0].isQuote).toBe(true);
      expect(result.tweets[0].isRetweet).toBe(false);
    });

    // VS-2: retweet-of-quote — outer has retweetedTweet, and the retweeted tweet has quoted
    it("extracts quotedTweet from retweet-of-quote", async () => {
      const stub = makeRettiwtStub();
      const deepInner = makeFakeTweet({
        id: "deep-quoted-id",
        fullText: "the deepest thought",
        tweetBy: { userName: "deepAuthor" },
        createdAt: "2026-04-29T10:00:00.000Z",
        media: [{ type: MediaType.PHOTO, url: "https://pbs/deep.jpg" }],
      });
      const retweetedInner = makeFakeTweet({
        id: "rt-inner-id",
        fullText: "the quote-tweeter's take",
        tweetBy: { userName: "quoter" },
        quoted: deepInner,
      });
      const outer = makeFakeTweet({
        id: "outer-rt-id",
        fullText: "RT @quoter: ...",
        tweetBy: { userName: "rter" },
        retweetedTweet: retweetedInner,
      });
      stub.list.tweets.mockResolvedValueOnce(makeCursored([outer], null));

      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("L");

      // outer fields come from retweetedInner (existing behaviour preserved)
      expect(result.tweets[0].id).toBe("rt-inner-id");
      expect(result.tweets[0].authorHandle).toBe("quoter");
      expect(result.tweets[0].fullText).toBe("the quote-tweeter's take");

      // quoted tweet is the deep inner
      expect(result.tweets[0].quotedTweet).toEqual({
        id: "deep-quoted-id",
        authorHandle: "deepAuthor",
        fullText: "the deepest thought",
        url: "https://x.com/deepAuthor/status/deep-quoted-id",
        createdAt: "2026-04-29T10:00:00.000Z",
        photoUrls: ["https://pbs/deep.jpg"],
      });
      // VS-7 trade-off: isRetweet is true; isQuote is false because we check
      // `!!t.quoted` on the OUTER envelope (the retweet wrapper has no top-level
      // `quoted`). The quoted content is still extracted via inner unwrap.
      expect(result.tweets[0].isRetweet).toBe(true);
      expect(result.tweets[0].isQuote).toBe(false);
    });

    // VS-3: plain tweets, retweets of non-quotes, tweets with no quoted field
    it("leaves quotedTweet undefined for plain tweets", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(
        makeCursored([makeFakeTweet({ id: "plain" })], null),
      );
      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("L");
      expect(result.tweets[0].quotedTweet).toBeUndefined();
    });

    it("leaves quotedTweet undefined for retweet of non-quote", async () => {
      const stub = makeRettiwtStub();
      const inner = makeFakeTweet({ id: "inner-non-quote", tweetBy: { userName: "orig" } });
      const outer = makeFakeTweet({ id: "rt-outer", retweetedTweet: inner });
      stub.list.tweets.mockResolvedValueOnce(makeCursored([outer], null));
      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("L");
      expect(result.tweets[0].quotedTweet).toBeUndefined();
    });

    it("leaves quotedTweet undefined when no quoted field present", async () => {
      const stub = makeRettiwtStub();
      // makeFakeTweet does not set quoted — the field is absent by default
      stub.list.tweets.mockResolvedValueOnce(
        makeCursored([makeFakeTweet({ id: "no-quoted" })], null),
      );
      const client = createRettiwtClient({ rettiwt: stub });
      const result = await client.fetchListTweets("L");
      expect(result.tweets[0].quotedTweet).toBeUndefined();
    });
  });

  describe("AbortSignal", () => {
    it("rejects with AbortError when signal is already aborted", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockResolvedValueOnce(makeCursored([], null));
      const client = createRettiwtClient({ rettiwt: stub });
      const ctrl = new AbortController();
      ctrl.abort();

      await expect(client.fetchListTweets("L", { signal: ctrl.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("rejects with AbortError when aborted mid-call", async () => {
      const stub = makeRettiwtStub();
      stub.list.tweets.mockReturnValueOnce(
        new Promise<RettiwtCursoredPage>(() => undefined),
      );
      const client = createRettiwtClient({ rettiwt: stub });
      const ctrl = new AbortController();
      const p = client.fetchListTweets("L", { signal: ctrl.signal });
      ctrl.abort();

      await expect(p).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});
