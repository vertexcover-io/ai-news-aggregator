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
  fetchHnPost,
  parseHnItemIdFromUrl,
  UrlParseError,
} from "@pipeline/collectors/hn.js";

interface MockResp {
  ok: boolean;
  status: number;
  body: unknown;
}

function makeFetch(responses: MockResp[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn((_url: string, _init?: RequestInit) => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    if (!r) return Promise.reject(new Error("no response"));
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
}

const HN_STORY = {
  id: 12345,
  type: "story",
  by: "alice",
  title: "A Neat Thing",
  url: "https://example.com/thing",
  score: 42,
  descendants: 7,
  time: 1_700_000_000,
  text: null,
};

describe("parseHnItemIdFromUrl", () => {
  it("parses news.ycombinator.com/item?id=N", () => {
    expect(parseHnItemIdFromUrl("https://news.ycombinator.com/item?id=12345")).toBe(
      "12345",
    );
  });

  it("parses hn.algolia.com story hashbang URLs", () => {
    expect(
      parseHnItemIdFromUrl("https://hn.algolia.com/?#!/story/forever/0/12345"),
    ).toBe("12345");
  });

  it("returns null for unrelated URLs", () => {
    expect(parseHnItemIdFromUrl("https://example.com/x")).toBeNull();
  });

  it("returns null for missing id", () => {
    expect(parseHnItemIdFromUrl("https://news.ycombinator.com/item")).toBeNull();
  });
});

describe("fetchHnPost", () => {
  it("returns a RawItemInsert for a valid HN story URL and forwards the AbortSignal", async () => {
    const fetchFn = makeFetch([{ ok: true, status: 200, body: HN_STORY }]);
    const ac = new AbortController();
    const result = await fetchHnPost(
      "https://news.ycombinator.com/item?id=12345",
      { fetchFn, signal: ac.signal },
    );
    expect(result.sourceType).toBe("hn");
    expect(result.externalId).toBe("12345");
    expect(result.title).toBe("A Neat Thing");
    expect(result.url).toBe("https://example.com/thing");
    expect(result.author).toBe("alice");
    expect(result.engagement).toEqual({ points: 42, commentCount: 7 });
    // The run-level cancellation signal must reach the underlying fetch.
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.signal).toBe(ac.signal);
  });

  it("returns a RawItemInsert for a valid Algolia story URL", async () => {
    const fetchFn = makeFetch([{ ok: true, status: 200, body: HN_STORY }]);
    const result = await fetchHnPost(
      "https://hn.algolia.com/?#!/story/forever/0/12345",
      { fetchFn },
    );
    expect(result.externalId).toBe("12345");
  });

  it("throws UrlParseError for a comment URL (item type=comment)", async () => {
    const fetchFn = makeFetch([
      {
        ok: true,
        status: 200,
        body: { ...HN_STORY, type: "comment", title: null },
      },
    ]);
    await expect(
      fetchHnPost("https://news.ycombinator.com/item?id=12345", { fetchFn }),
    ).rejects.toBeInstanceOf(UrlParseError);
  });

  it("throws UrlParseError for a malformed URL", async () => {
    const fetchFn = makeFetch([]);
    await expect(
      fetchHnPost("https://example.com/not-hn", { fetchFn }),
    ).rejects.toBeInstanceOf(UrlParseError);
  });

  it("throws on API 404", async () => {
    const fetchFn = makeFetch([{ ok: false, status: 404, body: null }]);
    await expect(
      fetchHnPost("https://news.ycombinator.com/item?id=99999", { fetchFn }),
    ).rejects.toThrow();
  });

  it("throws on null response body (item deleted)", async () => {
    const fetchFn = makeFetch([{ ok: true, status: 200, body: null }]);
    await expect(
      fetchHnPost("https://news.ycombinator.com/item?id=99999", { fetchFn }),
    ).rejects.toThrow();
  });
});
