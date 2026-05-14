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
      stub.list.tweets.mockImplementationOnce(
        () => new Promise<RettiwtCursoredPage>(() => undefined),
      );
      const client = createRettiwtClient({ rettiwt: stub });
      const ctrl = new AbortController();
      const p = client.fetchListTweets("L", { signal: ctrl.signal });
      ctrl.abort();

      await expect(p).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});
