import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

vi.mock("@pipeline/lib/proxy-fetch.js", () => {
  return {
    createProxyFetch: vi.fn(() => globalThis.fetch),
  };
});

const ORIGINAL_PROXY_ENV = process.env.REDDIT_HTTP_PROXY;

function makeRepo(): RawItemsRepo {
  return {
    upsertItems: vi.fn().mockResolvedValue(undefined),
  } as unknown as RawItemsRepo;
}

afterEach(() => {
  if (ORIGINAL_PROXY_ENV === undefined) {
    delete process.env.REDDIT_HTTP_PROXY;
  } else {
    process.env.REDDIT_HTTP_PROXY = ORIGINAL_PROXY_ENV;
  }
  vi.resetModules();
  vi.clearAllMocks();
});

describe("collectReddit — proxy wiring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // REQ-3: when no fetchFn injected and env is set, createProxyFetch is called with env value
  it("invokes createProxyFetch with REDDIT_HTTP_PROXY when no fetchFn provided", async () => {
    process.env.REDDIT_HTTP_PROXY = "http://user:pass@proxy.test:8080";
    const proxyMod = await import("@pipeline/lib/proxy-fetch.js");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ kind: "Listing", data: { children: [] } }),
    });
    (proxyMod.createProxyFetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockFetch);

    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    await collectReddit({ rawItemsRepo: makeRepo() }, { subreddits: ["MachineLearning"] });

    expect(proxyMod.createProxyFetch).toHaveBeenCalledWith("http://user:pass@proxy.test:8080");
    expect(mockFetch).toHaveBeenCalled();
  });

  // REQ-5 / EDGE-4: caller fetchFn wins, createProxyFetch must not be called
  it("does not call createProxyFetch when caller injects fetchFn", async () => {
    process.env.REDDIT_HTTP_PROXY = "http://user:pass@proxy.test:8080";
    const proxyMod = await import("@pipeline/lib/proxy-fetch.js");
    const callerFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ kind: "Listing", data: { children: [] } }),
    });

    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    await collectReddit(
      { rawItemsRepo: makeRepo(), fetchFn: callerFetch as unknown as typeof fetch },
      { subreddits: ["MachineLearning"] },
    );

    expect(proxyMod.createProxyFetch).not.toHaveBeenCalled();
    expect(callerFetch).toHaveBeenCalled();
  });
});

describe("fetchRedditPost — proxy wiring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // REQ-4
  it("invokes createProxyFetch with REDDIT_HTTP_PROXY when no fetchFn provided", async () => {
    process.env.REDDIT_HTTP_PROXY = "http://user:pass@proxy.test:8080";
    const proxyMod = await import("@pipeline/lib/proxy-fetch.js");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            kind: "Listing",
            data: {
              children: [
                {
                  kind: "t3",
                  data: {
                    id: "abc",
                    title: "t",
                    url: "https://example.com",
                    permalink: "/r/MachineLearning/comments/abc/t/",
                    author: "u",
                    selftext: "",
                    is_self: false,
                    score: 1,
                    num_comments: 0,
                    created_utc: 1700000000,
                    stickied: false,
                    subreddit: "MachineLearning",
                    thumbnail: "self",
                  },
                },
              ],
            },
          },
          { kind: "Listing", data: { children: [] } },
        ]),
    });
    (proxyMod.createProxyFetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockFetch);

    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    await fetchRedditPost(
      "https://www.reddit.com/r/MachineLearning/comments/abc/t/",
    );

    expect(proxyMod.createProxyFetch).toHaveBeenCalledWith("http://user:pass@proxy.test:8080");
    expect(mockFetch).toHaveBeenCalled();
  });

  // REQ-5
  it("does not call createProxyFetch when caller injects fetchFn", async () => {
    process.env.REDDIT_HTTP_PROXY = "http://user:pass@proxy.test:8080";
    const proxyMod = await import("@pipeline/lib/proxy-fetch.js");
    const callerFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            kind: "Listing",
            data: {
              children: [
                {
                  kind: "t3",
                  data: {
                    id: "abc",
                    title: "t",
                    url: "https://example.com",
                    permalink: "/r/MachineLearning/comments/abc/t/",
                    author: "u",
                    selftext: "",
                    is_self: false,
                    score: 1,
                    num_comments: 0,
                    created_utc: 1700000000,
                    stickied: false,
                    subreddit: "MachineLearning",
                    thumbnail: "self",
                  },
                },
              ],
            },
          },
          { kind: "Listing", data: { children: [] } },
        ]),
    });

    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    await fetchRedditPost(
      "https://www.reddit.com/r/MachineLearning/comments/abc/t/",
      { fetchFn: callerFetch as unknown as typeof fetch },
    );

    expect(proxyMod.createProxyFetch).not.toHaveBeenCalled();
    expect(callerFetch).toHaveBeenCalled();
  });
});
