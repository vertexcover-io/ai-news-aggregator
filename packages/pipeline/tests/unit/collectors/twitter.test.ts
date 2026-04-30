import { describe, it, expect, vi } from "vitest";
import {
  parseCookieEnv,
  buildTitle,
  buildContent,
  pickImageUrl,
  toRawItem,
  collectTwitter,
  cookiesToStrings,
  TwitterAuthError,
  TwitterRateLimitError,
  type TwitterTweet,
  type TwitterCollectorDeps,
  type TwitterClient,
} from "@pipeline/collectors/twitter.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTweet(overrides: Partial<TwitterTweet> = {}): TwitterTweet {
  return {
    id: "tweet123",
    text: "Hello Twitter",
    permanentUrl: "https://x.com/testuser/status/tweet123",
    username: "testuser",
    name: "Test User",
    timeParsed: new Date("2026-04-30T12:00:00Z"),
    likes: 42,
    replies: 5,
    retweets: 10,
    views: 1000,
    isRetweet: false,
    isReply: false,
    photos: [],
    quotedStatus: undefined,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TwitterCollectConfig> = {}): TwitterCollectConfig {
  return {
    users: ["testuser"],
    listIds: [],
    maxPerSource: 10,
    sinceDays: 7,
    ...overrides,
  };
}

function makeRepo(): RawItemsRepo {
  return {
    upsertItems: vi.fn().mockResolvedValue(undefined),
    findByExternalIds: vi.fn().mockResolvedValue([]),
  } as unknown as RawItemsRepo;
}

// ---------------------------------------------------------------------------
// parseCookieEnv
// ---------------------------------------------------------------------------

describe("parseCookieEnv", () => {
  it("REQ-020: throws TwitterAuthError when env is undefined", () => {
    expect(() => parseCookieEnv(undefined)).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv(undefined)).toThrow("TWITTER_COOKIES_JSON not set");
  });

  it("REQ-020: throws TwitterAuthError when env is empty string", () => {
    expect(() => parseCookieEnv("")).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv("")).toThrow("TWITTER_COOKIES_JSON not set");
  });

  it("REQ-021: throws TwitterAuthError with prefix when JSON.parse fails", () => {
    expect(() => parseCookieEnv("{not-json")).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv("{not-json")).toThrow(/^invalid TWITTER_COOKIES_JSON:/);
  });

  it("REQ-022: throws when parsed value is not an array (object)", () => {
    expect(() => parseCookieEnv('{"name":"x"}')).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv('{"name":"x"}')).toThrow("invalid cookie shape");
  });

  it("REQ-022: throws when array contains strings instead of objects", () => {
    expect(() => parseCookieEnv('["abc"]')).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv('["abc"]')).toThrow("invalid cookie shape");
  });

  it("REQ-022: throws when cookie object is missing name field", () => {
    expect(() => parseCookieEnv('[{"value":"v"}]')).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv('[{"value":"v"}]')).toThrow("invalid cookie shape");
  });

  it("REQ-022: throws when cookie object is missing value field", () => {
    expect(() => parseCookieEnv('[{"name":"n"}]')).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv('[{"name":"n"}]')).toThrow("invalid cookie shape");
  });

  it("EDGE-014: accepts cookies with extra fields", () => {
    const raw = '[{"name":"auth_token","value":"abc123","domain":".x.com","httpOnly":true}]';
    expect(() => parseCookieEnv(raw)).not.toThrow();
    const result = parseCookieEnv(raw);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("EDGE-015: throws when root is an object not an array", () => {
    expect(() => parseCookieEnv("{}"  )).toThrowError(TwitterAuthError);
    expect(() => parseCookieEnv("{}")).toThrow("invalid cookie shape");
  });

  it("REQ-022: accepts valid cookie array", () => {
    const raw = '[{"name":"auth_token","value":"secret"}]';
    const result = parseCookieEnv(raw);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cookiesToStrings
// ---------------------------------------------------------------------------

describe("cookiesToStrings", () => {
  it("converts {name,value} to a Set-Cookie-style string with Domain=.twitter.com", () => {
    const out = cookiesToStrings([{ name: "auth_token", value: "abc" }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("auth_token=abc");
    expect(out[0]).toContain("Domain=.twitter.com");
    expect(out[0]).toContain("Path=/");
  });

  it("forces Domain=.twitter.com even when input cookie has Domain=.x.com", () => {
    const out = cookiesToStrings([
      { name: "auth_token", value: "abc", domain: ".x.com", path: "/" },
    ]);
    expect(out[0]).toContain("Domain=.twitter.com");
    expect(out[0]).not.toContain(".x.com");
  });

  it("preserves Path when provided", () => {
    const out = cookiesToStrings([
      { name: "x", value: "y", path: "/foo" },
    ]);
    expect(out[0]).toContain("Path=/foo");
  });

  it("includes Secure / HttpOnly / SameSite when set", () => {
    const out = cookiesToStrings([
      { name: "x", value: "y", secure: true, httpOnly: true, sameSite: "None" },
    ]);
    expect(out[0]).toContain("Secure");
    expect(out[0]).toContain("HttpOnly");
    expect(out[0]).toContain("SameSite=None");
  });

  it("omits Secure / HttpOnly when falsy", () => {
    const out = cookiesToStrings([{ name: "x", value: "y" }]);
    expect(out[0]).not.toContain("Secure");
    expect(out[0]).not.toContain("HttpOnly");
    expect(out[0]).not.toContain("SameSite");
  });

  it("returns one string per input cookie in order", () => {
    const out = cookiesToStrings([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
      { name: "c", value: "3" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("a=1");
    expect(out[1]).toContain("b=2");
    expect(out[2]).toContain("c=3");
  });
});

// ---------------------------------------------------------------------------
// buildTitle
// ---------------------------------------------------------------------------

describe("buildTitle", () => {
  it("EDGE-005: returns [media] for empty text", () => {
    expect(buildTitle("")).toBe("[media]");
  });

  it("REQ-007: returns text unchanged when text is exactly 200 chars", () => {
    const text = "a".repeat(200);
    const result = buildTitle(text);
    expect(result).toBe(text);
    expect(result).toHaveLength(200);
  });

  it("REQ-007: truncates at 200 chars with ellipsis when text exceeds 200 chars", () => {
    const text = "a".repeat(201);
    const result = buildTitle(text);
    expect(result).toHaveLength(200);
    expect(result.endsWith("…")).toBe(true);
    // The content before ellipsis should be 199 'a' chars
    expect(result).toBe("a".repeat(199) + "…");
  });

  it("REQ-007: returns short text unchanged", () => {
    const text = "Short tweet";
    expect(buildTitle(text)).toBe("Short tweet");
  });

  it("REQ-007: text of 199 chars is unchanged", () => {
    const text = "a".repeat(199);
    const result = buildTitle(text);
    expect(result).toBe(text);
    expect(result).toHaveLength(199);
  });
});

// ---------------------------------------------------------------------------
// buildContent
// ---------------------------------------------------------------------------

describe("buildContent", () => {
  it("REQ-008: returns text when no quoted tweet", () => {
    expect(buildContent("Hello world")).toBe("Hello world");
  });

  it("REQ-008: appends quoted tweet text with prefix", () => {
    const quoted: TwitterTweet = { id: "q1", text: "Quoted text" };
    expect(buildContent("Main text", quoted)).toBe("Main text\n\n> Quoted text");
  });

  it("REQ-008: handles quoted tweet with undefined text", () => {
    const quoted: TwitterTweet = { id: "q1", text: undefined };
    expect(buildContent("Main text", quoted)).toBe("Main text\n\n> ");
  });

  it("EDGE-009: long quoted text concatenates without truncation", () => {
    const longQuoted = "x".repeat(10000);
    const quoted: TwitterTweet = { id: "q1", text: longQuoted };
    const result = buildContent("Main", quoted);
    expect(result).toBe("Main\n\n> " + longQuoted);
  });
});

// ---------------------------------------------------------------------------
// pickImageUrl
// ---------------------------------------------------------------------------

describe("pickImageUrl", () => {
  it("EDGE-007: returns null when photos is undefined", () => {
    const tweet: TwitterTweet = { id: "1", text: "no photos" };
    expect(pickImageUrl(tweet)).toBeNull();
  });

  it("EDGE-007: returns null when photos array is empty", () => {
    const tweet = makeTweet({ photos: [] });
    expect(pickImageUrl(tweet)).toBeNull();
  });

  it("REQ-006: returns first photo url", () => {
    const tweet = makeTweet({
      photos: [
        { id: "p1", url: "https://pbs.twimg.com/media/photo1.jpg", alt_text: undefined },
        { id: "p2", url: "https://pbs.twimg.com/media/photo2.jpg", alt_text: undefined },
      ],
    });
    expect(pickImageUrl(tweet)).toBe("https://pbs.twimg.com/media/photo1.jpg");
  });

  it("EDGE-008: returns only first photo when multiple exist", () => {
    const tweet = makeTweet({
      photos: [
        { id: "p1", url: "https://pbs.twimg.com/media/first.jpg", alt_text: undefined },
        { id: "p2", url: "https://pbs.twimg.com/media/second.jpg", alt_text: undefined },
        { id: "p3", url: "https://pbs.twimg.com/media/third.jpg", alt_text: undefined },
      ],
    });
    expect(pickImageUrl(tweet)).toBe("https://pbs.twimg.com/media/first.jpg");
  });
});

// ---------------------------------------------------------------------------
// toRawItem
// ---------------------------------------------------------------------------

describe("toRawItem", () => {
  it("EDGE-017: returns null when tweet.id is missing", () => {
    const tweet: TwitterTweet = { text: "no id" };
    expect(toRawItem(tweet, { kind: "user", handle: "testuser" })).toBeNull();
  });

  it("REQ-006/009: maps a fully-populated tweet (user origin)", () => {
    const tweet = makeTweet();
    const result = toRawItem(tweet, { kind: "user", handle: "testuser" });
    if (!result) throw new Error("expected non-null result");
    expect(result.sourceType).toBe("twitter");
    expect(result.externalId).toBe("tweet123");
    expect(result.url).toBe("https://x.com/testuser/status/tweet123");
    expect(result.sourceUrl).toBe("https://x.com/testuser/status/tweet123");
    expect(result.author).toBe("testuser");
    expect(result.content).toBe("Hello Twitter");
    expect(result.publishedAt).toEqual(new Date("2026-04-30T12:00:00Z"));
    expect(result.engagement).toEqual({ points: 42, commentCount: 5 });
    expect(result.imageUrl).toBeNull();
    expect(result.metadata.twitter).toBeDefined();
    const twitter = result.metadata.twitter;
    if (!twitter) throw new Error("expected twitter metadata");
    expect(twitter.origin).toEqual({ kind: "user", handle: "testuser" });
    expect(twitter.retweetCount).toBe(10);
    expect(twitter.viewCount).toBe(1000);
    expect(twitter.displayName).toBe("Test User");
    expect(twitter.isReply).toBe(false);
  });

  it("REQ-009: sets origin.kind='list' and origin.listId for list-fetched items", () => {
    const tweet = makeTweet();
    const result = toRawItem(tweet, { kind: "list", listId: "987654321" });
    if (!result) throw new Error("expected non-null result");
    const twitter = result.metadata.twitter;
    if (!twitter) throw new Error("expected twitter metadata");
    expect(twitter.origin).toEqual({ kind: "list", listId: "987654321" });
  });

  it("REQ-006: handles sparse tweet with missing fields (fallbacks)", () => {
    const tweet: TwitterTweet = { id: "sparse1", text: "Sparse tweet" };
    const result = toRawItem(tweet, { kind: "user", handle: "unknown" });
    if (!result) throw new Error("expected non-null result");
    expect(result.url).toBe("https://x.com/unknown/status/sparse1");
    expect(result.author).toBe("unknown");
    expect(result.engagement).toEqual({ points: 0, commentCount: 0 });
    expect(result.imageUrl).toBeNull();
    const twitter = result.metadata.twitter;
    if (!twitter) throw new Error("expected twitter metadata");
    expect(twitter.retweetCount).toBe(0);
    expect(twitter.viewCount).toBeNull();
    expect(twitter.displayName).toBeNull();
    expect(twitter.isReply).toBe(false);
  });

  it("EDGE-006: uses new Date() as fallback when timeParsed is missing", () => {
    const before = Date.now();
    const tweet: TwitterTweet = { id: "notime1", text: "No time" };
    const result = toRawItem(tweet, { kind: "user", handle: "user1" });
    const after = Date.now();
    if (!result) throw new Error("expected non-null result");
    expect(result.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.publishedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("EDGE-005: empty text produces title='[media]'", () => {
    const tweet = makeTweet({ text: "" });
    const result = toRawItem(tweet, { kind: "user", handle: "testuser" });
    if (!result) throw new Error("expected non-null result");
    expect(result.title).toBe("[media]");
    expect(result.content).toBe("");
  });

  it("REQ-007: title is truncated to 200 chars with ellipsis for long text", () => {
    const longText = "a".repeat(250);
    const tweet = makeTweet({ text: longText });
    const result = toRawItem(tweet, { kind: "user", handle: "testuser" });
    if (!result) throw new Error("expected non-null result");
    expect(result.title).toHaveLength(200);
    expect(result.title.endsWith("…")).toBe(true);
  });

  it("REQ-008: appends quoted tweet text to content", () => {
    const quoted: TwitterTweet = { id: "q1", text: "Quoted content here" };
    const tweet = makeTweet({ text: "Main tweet", quotedStatus: quoted });
    const result = toRawItem(tweet, { kind: "user", handle: "testuser" });
    if (!result) throw new Error("expected non-null result");
    expect(result.content).toBe("Main tweet\n\n> Quoted content here");
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — mock client helpers
// ---------------------------------------------------------------------------

// Returns an async iterable from an array without using async generators
// (avoids @typescript-eslint/require-await lint errors in mock functions).
function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let idx = 0;
      return {
        next(): Promise<IteratorResult<T>> {
          if (idx < items.length) {
            return Promise.resolve({ value: items[idx++], done: false } as IteratorYieldResult<T>);
          }
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
      };
    },
  };
}

function makeClient(overrides: Partial<TwitterClient> = {}): TwitterClient {
  return {
    setCookies: vi.fn().mockResolvedValue(undefined),
    isLoggedIn: vi.fn().mockResolvedValue(true),
    getTweets: vi.fn().mockReturnValue(asyncIter([makeTweet()])),
    fetchListTweets: vi.fn().mockResolvedValue({ tweets: [makeTweet({ id: "list1" })] }),
    ...overrides,
  };
}

const VALID_COOKIES_JSON = '[{"name":"auth_token","value":"secret"}]';

function makeDeps(
  overrides: Partial<TwitterCollectorDeps> = {},
): TwitterCollectorDeps {
  return {
    rawItemsRepo: makeRepo(),
    envCookies: VALID_COOKIES_JSON,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// collectTwitter — EDGE-001: empty sources
// ---------------------------------------------------------------------------

describe("collectTwitter — empty sources (EDGE-001)", () => {
  it("EDGE-001: returns zeros without instantiating the scraper when users and listIds are empty", async () => {
    const clientFactory = vi.fn();
    const deps = makeDeps({ clientFactory });
    const config = makeConfig({ users: [], listIds: [] });

    const result = await collectTwitter(deps, config);

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(clientFactory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — auth errors (REQ-020, REQ-021, REQ-022)
// ---------------------------------------------------------------------------

describe("collectTwitter — auth errors", () => {
  it("REQ-020: throws TwitterAuthError when envCookies is undefined", async () => {
    const clientFactory = vi.fn();
    const deps = makeDeps({ envCookies: undefined, clientFactory });
    const config = makeConfig();

    await expect(collectTwitter(deps, config)).rejects.toThrow(TwitterAuthError);
    await expect(collectTwitter(deps, config)).rejects.toThrow("TWITTER_COOKIES_JSON not set");
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("REQ-020: throws TwitterAuthError when envCookies is empty string", async () => {
    const deps = makeDeps({ envCookies: "" });
    const config = makeConfig();
    await expect(collectTwitter(deps, config)).rejects.toThrow(TwitterAuthError);
  });

  it("REQ-021: throws TwitterAuthError with prefix for invalid JSON", async () => {
    const deps = makeDeps({ envCookies: "{bad json" });
    const config = makeConfig();
    await expect(collectTwitter(deps, config)).rejects.toThrow(TwitterAuthError);
    await expect(collectTwitter(deps, config)).rejects.toThrow(/^invalid TWITTER_COOKIES_JSON:/);
  });

  it("REQ-022: throws TwitterAuthError for invalid cookie shape", async () => {
    const deps = makeDeps({ envCookies: '["not-an-object"]' });
    const config = makeConfig();
    await expect(collectTwitter(deps, config)).rejects.toThrow(TwitterAuthError);
    await expect(collectTwitter(deps, config)).rejects.toThrow("invalid cookie shape");
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — auth probe (REQ-023, REQ-024, REQ-025, EDGE-013)
// ---------------------------------------------------------------------------

describe("collectTwitter — auth probe", () => {
  it("REQ-023: setCookies is called before any getTweets/fetchListTweets", async () => {
    const callOrder: string[] = [];
    const client = makeClient({
      setCookies: vi.fn().mockImplementation(() => {
        callOrder.push("setCookies");
        return Promise.resolve();
      }),
      isLoggedIn: vi.fn().mockImplementation(() => {
        callOrder.push("isLoggedIn");
        return Promise.resolve(true);
      }),
      getTweets: vi.fn().mockImplementation(() => {
        callOrder.push("getTweets");
        return asyncIter([makeTweet()]);
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    await collectTwitter(deps, makeConfig({ users: ["testuser"], listIds: [] }));

    const setCookiesIdx = callOrder.indexOf("setCookies");
    const getTweetsIdx = callOrder.indexOf("getTweets");
    expect(setCookiesIdx).toBeLessThan(getTweetsIdx);
  });

  it("REQ-024: isLoggedIn probe runs before any source fetch", async () => {
    const callOrder: string[] = [];
    const client = makeClient({
      setCookies: vi.fn().mockImplementation(() => {
        callOrder.push("setCookies");
        return Promise.resolve();
      }),
      isLoggedIn: vi.fn().mockImplementation(() => {
        callOrder.push("isLoggedIn");
        return Promise.resolve(true);
      }),
      getTweets: vi.fn().mockImplementation(() => {
        callOrder.push("getTweets");
        return asyncIter([makeTweet()]);
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    await collectTwitter(deps, makeConfig({ users: ["testuser"], listIds: [] }));

    const probeIdx = callOrder.indexOf("isLoggedIn");
    const getTweetsIdx = callOrder.indexOf("getTweets");
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    expect(probeIdx).toBeLessThan(getTweetsIdx);
  });

  it("REQ-025: probe returning false throws TwitterAuthError and no source fetches occur", async () => {
    const getTweets = vi.fn();
    const fetchListTweets = vi.fn();
    const client = makeClient({
      isLoggedIn: vi.fn().mockResolvedValue(false),
      getTweets: getTweets as unknown as TwitterClient["getTweets"],
      fetchListTweets,
    });

    const deps = makeDeps({ clientFactory: () => client });
    const config = makeConfig({ users: ["testuser"], listIds: ["123456"] });

    await expect(collectTwitter(deps, config)).rejects.toThrow(TwitterAuthError);
    await expect(collectTwitter(deps, config)).rejects.toThrow(/^session rejected/);
    expect(getTweets).not.toHaveBeenCalled();
    expect(fetchListTweets).not.toHaveBeenCalled();
  });

  it("EDGE-013: probe throwing is treated same as returning false", async () => {
    const client = makeClient({
      isLoggedIn: vi.fn().mockRejectedValue(new Error("network error")),
    });

    const deps = makeDeps({ clientFactory: () => client });
    await expect(collectTwitter(deps, makeConfig())).rejects.toThrow(TwitterAuthError);
    await expect(collectTwitter(deps, makeConfig())).rejects.toThrow(/^session rejected/);
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — single client instantiation (REQ-002)
// ---------------------------------------------------------------------------

describe("collectTwitter — client instantiation (REQ-002)", () => {
  it("REQ-002: clientFactory is called exactly once for multiple users and lists", async () => {
    const client = makeClient();
    const clientFactory = vi.fn().mockReturnValue(client);

    const deps = makeDeps({ clientFactory });
    const config = makeConfig({ users: ["userA", "userB"], listIds: ["111111", "222222"] });

    await collectTwitter(deps, config);

    expect(clientFactory).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — source iteration (REQ-003, REQ-004, REQ-005, EDGE-010, EDGE-016)
// ---------------------------------------------------------------------------

describe("collectTwitter — source iteration", () => {
  it("REQ-003: getTweets is called per user in declared order", async () => {
    const getTweetsCalls: string[] = [];
    const client = makeClient({
      getTweets: vi.fn().mockImplementation((handle: string) => {
        getTweetsCalls.push(handle);
        return asyncIter([makeTweet({ id: `tweet-${handle}`, username: handle })]);
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    const config = makeConfig({ users: ["alice", "bob", "charlie"], listIds: [] });
    await collectTwitter(deps, config);

    expect(getTweetsCalls).toEqual(["alice", "bob", "charlie"]);
  });

  it("REQ-004: fetchListTweets is called per list in declared order", async () => {
    const fetchListCalls: string[] = [];
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(asyncIter([])),
      fetchListTweets: vi.fn().mockImplementation((listId: string) => {
        fetchListCalls.push(listId);
        return Promise.resolve({ tweets: [makeTweet({ id: `tweet-list-${listId}` })] });
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    const config = makeConfig({ users: [], listIds: ["111111", "222222", "333333"] });
    await collectTwitter(deps, config);

    expect(fetchListCalls).toEqual(["111111", "222222", "333333"]);
  });

  it("REQ-005: all sources are fetched in order (delay runs between them)", async () => {
    // The 1000ms delay is real — this test verifies ordering, not the delay duration.
    // Per the phase doc: delay happens between calls, not before the first.
    const callOrder: string[] = [];
    const client = makeClient({
      getTweets: vi.fn().mockImplementation((handle: string) => {
        callOrder.push(`getTweets:${handle}`);
        return asyncIter([makeTweet({ id: `t-${handle}`, username: handle })]);
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    const config = makeConfig({ users: ["u1", "u2", "u3"], listIds: [] });
    await collectTwitter(deps, config);

    // All 3 users were fetched in declared order.
    // The delay between them is 1000ms per the RATE_LIMIT_MS constant — tested
    // by asserting the call order is preserved (delay doesn't re-order).
    expect(callOrder).toEqual(["getTweets:u1", "getTweets:u2", "getTweets:u3"]);
  });

  it("EDGE-010: pre-aborted signal causes early return with zero items", async () => {
    const controller = new AbortController();
    controller.abort();

    const getTweets = vi.fn();
    const client = makeClient({
      getTweets: getTweets as unknown as TwitterClient["getTweets"],
    });

    const deps = makeDeps({ clientFactory: () => client, signal: controller.signal });
    const config = makeConfig({ users: ["testuser"], listIds: [] });

    const result = await collectTwitter(deps, config);
    expect(getTweets).not.toHaveBeenCalled();
    expect(result.itemsFetched).toBe(0);
  });

  it("EDGE-016: getTweets returning async iterable is fully consumed", async () => {
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(
        asyncIter([
          makeTweet({ id: "iter1" }),
          makeTweet({ id: "iter2" }),
          makeTweet({ id: "iter3" }),
        ]),
      ),
    });

    const deps = makeDeps({ clientFactory: () => client });
    const config = makeConfig({ users: ["testuser"], listIds: [] });

    const result = await collectTwitter(deps, config);
    expect(result.itemsFetched).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — filtering (REQ-010, REQ-011, REQ-012)
// ---------------------------------------------------------------------------

describe("collectTwitter — filtering", () => {
  it("REQ-010: drops retweets from results", async () => {
    const retweet = makeTweet({ id: "rt1", isRetweet: true });
    const original1 = makeTweet({ id: "orig1", isRetweet: false });
    const original2 = makeTweet({ id: "orig2", isRetweet: false });

    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(asyncIter([retweet, original1, original2])),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });
    const config = makeConfig({ users: ["testuser"], listIds: [] });

    const result = await collectTwitter(deps, config);

    expect(result.itemsFetched).toBe(2);
    const upsertCall = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0];
    const upsertedIds = (upsertCall[0] as { externalId: string }[]).map((i) => i.externalId);
    expect(upsertedIds).not.toContain("rt1");
    expect(upsertedIds).toContain("orig1");
    expect(upsertedIds).toContain("orig2");
  });

  it("REQ-011: keeps replies in results", async () => {
    const reply = makeTweet({ id: "reply1", isReply: true });

    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(asyncIter([reply])),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });
    const config = makeConfig({ users: ["testuser"], listIds: [] });

    const result = await collectTwitter(deps, config);
    expect(result.itemsFetched).toBe(1);
    const upsertCall = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0];
    const upsertedIds = (upsertCall[0] as { externalId: string }[]).map((i) => i.externalId);
    expect(upsertedIds).toContain("reply1");
  });

  it("REQ-012: drops items outside sinceDays window", async () => {
    const now = Date.now();
    const inside = makeTweet({
      id: "inside1",
      timeParsed: new Date(now - 1 * 86_400_000), // 1 day ago
    });
    const outside = makeTweet({
      id: "outside1",
      timeParsed: new Date(now - 10 * 86_400_000), // 10 days ago
    });

    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(asyncIter([inside, outside])),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });
    const config = makeConfig({ users: ["testuser"], listIds: [], sinceDays: 7 });

    const result = await collectTwitter(deps, config);
    expect(result.itemsFetched).toBe(1);
    const upsertCall = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0];
    const upsertedIds = (upsertCall[0] as { externalId: string }[]).map((i) => i.externalId);
    expect(upsertedIds).toContain("inside1");
    expect(upsertedIds).not.toContain("outside1");
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — repo and result (REQ-013, REQ-014)
// ---------------------------------------------------------------------------

describe("collectTwitter — repo and result shape", () => {
  it("REQ-013: upsertItems is called once when items > 0", async () => {
    const repo = makeRepo();
    const client = makeClient();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });

    await collectTwitter(deps, makeConfig());

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
  });

  it("REQ-013: upsertItems is NOT called when all items are filtered out", async () => {
    // All tweets are retweets (will be dropped)
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(
        asyncIter([
          makeTweet({ id: "rt1", isRetweet: true }),
          makeTweet({ id: "rt2", isRetweet: true }),
        ]),
      ),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });

    await collectTwitter(deps, makeConfig());

    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  it("REQ-014: returns correct CollectorResult shape", async () => {
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(
        asyncIter([makeTweet({ id: "r1" }), makeTweet({ id: "r2" })]),
      ),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });
    const config = makeConfig({ users: ["testuser"], listIds: [] });

    const result = await collectTwitter(deps, config);
    expect(result.itemsFetched).toBe(2);
    expect(result.itemsStored).toBe(2);
    expect(result.commentsFetched).toBe(0);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it("REQ-014: itemsFetched=0 and itemsStored=0 when no items pass filters", async () => {
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(asyncIter([makeTweet({ id: "rt1", isRetweet: true })])),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });

    const result = await collectTwitter(deps, makeConfig());
    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — EDGE-017: missing tweet.id drops item
// ---------------------------------------------------------------------------

describe("collectTwitter — EDGE-017 missing id", () => {
  it("EDGE-017: tweet with missing id is dropped, processing continues", async () => {
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue(
        asyncIter([{ text: "no id tweet" } as TwitterTweet, makeTweet({ id: "valid1" })]),
      ),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });

    const result = await collectTwitter(deps, makeConfig({ users: ["testuser"] }));
    expect(result.itemsFetched).toBe(1);
    const upsertCall = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0];
    const upsertedIds = (upsertCall[0] as { externalId: string }[]).map((i) => i.externalId);
    expect(upsertedIds).toContain("valid1");
  });
});

// ---------------------------------------------------------------------------
// collectTwitter — TwitterRateLimitError
// ---------------------------------------------------------------------------

describe("collectTwitter — rate limit error", () => {
  it("throws TwitterRateLimitError when library signals 429", async () => {
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<TwitterTweet>> {
              return Promise.reject(new Error("Rate limit exceeded: 429 Too Many Requests"));
            },
          };
        },
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    await expect(collectTwitter(deps, makeConfig({ users: ["testuser"] }))).rejects.toThrow(
      TwitterRateLimitError,
    );
  });

  // REQ-054: when rate-limit hits after first user already fetched items,
  // the prior items are upserted and the error carries partialItemCount > 0
  it("REQ-054: upserts partial items before throwing when rate-limit hits mid-stream", async () => {
    // First user returns 1 tweet; second user hits rate limit
    let callCount = 0;
    const client = makeClient({
      getTweets: vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          // First user — returns a valid tweet
          return asyncIter([makeTweet({ id: "partial-tweet-1" })]);
        }
        // Second user — throws rate limit
        return {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<TwitterTweet>> {
                return Promise.reject(new Error("Rate limit exceeded: 429 Too Many Requests"));
              },
            };
          },
        };
      }),
    });

    const repo = makeRepo();
    const deps = makeDeps({ clientFactory: () => client, rawItemsRepo: repo });
    const config = makeConfig({ users: ["alice", "bob"], listIds: [] });

    const error = await collectTwitter(deps, config).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TwitterRateLimitError);
    const rateLimitErr = error as TwitterRateLimitError;
    expect(rateLimitErr.partialItemCount).toBeGreaterThan(0);
    // upsertItems should have been called with the partial items collected before the rate limit
    expect(repo.upsertItems).toHaveBeenCalled();
  });

  // REQ-054: when rate-limit hits with no items yet, partialItemCount is 0
  it("REQ-054: partialItemCount=0 when rate-limit hits before any items collected", async () => {
    const client = makeClient({
      getTweets: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<TwitterTweet>> {
              return Promise.reject(new Error("Rate limit exceeded: 429 Too Many Requests"));
            },
          };
        },
      }),
    });

    const deps = makeDeps({ clientFactory: () => client });
    const error = await collectTwitter(deps, makeConfig({ users: ["testuser"] })).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TwitterRateLimitError);
    const rateLimitErr = error as TwitterRateLimitError;
    expect(rateLimitErr.partialItemCount).toBe(0);
  });
});
