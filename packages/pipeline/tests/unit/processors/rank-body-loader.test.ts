import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Candidate } from "@newsletter/shared";

const { mockLoggerWarn, mockFetchMarkdown } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockFetchMarkdown: vi.fn(),
}));

vi.mock("@pipeline/services/markdown-fetch.js", () => ({
  fetchMarkdown: mockFetchMarkdown,
}));

vi.mock("@newsletter/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@newsletter/shared")>(
      "@newsletter/shared",
    );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn(),
    })),
  };
});

import { loadBodiesForShortlist } from "@pipeline/processors/rank-body-loader.js";

function makeCandidate(
  id: number,
  content: string | null,
  url = `https://example.com/${id}`,
): Candidate {
  return {
    id,
    title: `title-${id}`,
    url,
    sourceType: "hn",
    author: null,
    publishedAt: new Date("2026-04-07T00:00:00Z"),
    engagement: { points: 0, commentCount: 0 },
    content,
    comments: [],
  };
}

describe("loadBodiesForShortlist", () => {
  beforeEach(() => {
    mockLoggerWarn.mockClear();
    mockFetchMarkdown.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses candidate.content directly with zero fetch calls (REQ-040)", async () => {
    const candidate = makeCandidate(1, "# body markdown");
    const fetchFn = vi.fn();

    const bodies = await loadBodiesForShortlist([candidate], { fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(bodies.get(1)).toBe("# body markdown");
  });

  it("calls fetchFn exactly once per null-content candidate (REQ-041)", async () => {
    const candidate = makeCandidate(1, null, "https://hn.example/post");
    const fetchFn = vi.fn(() => Promise.resolve("fetched body"));

    const bodies = await loadBodiesForShortlist([candidate], { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://hn.example/post");
    expect(bodies.get(1)).toBe("fetched body");
  });

  it("bounds concurrency via p-limit default of 3 (REQ-042)", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate(i + 1, null),
    );

    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async (): Promise<string> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return "body";
    });

    const bodies = await loadBodiesForShortlist(candidates, { fetchFn });

    expect(bodies.size).toBe(10);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(fetchFn).toHaveBeenCalledTimes(10);
  });

  it("respects the per-item timeout and returns null for hung fetches (REQ-043)", async () => {
    const candidate = makeCandidate(1, null);
    const fetchFn = vi.fn(
      (_url: string, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );

    const bodies = await loadBodiesForShortlist([candidate], {
      fetchFn: (url, signal) => fetchFn(url, signal),
      timeoutMs: 20,
    });

    expect(bodies.get(1)).toBeNull();
  });

  it("returns null entries for failing fetches and continues processing others (REQ-044)", async () => {
    const candidates = [
      makeCandidate(1, null, "https://a.example"),
      makeCandidate(2, null, "https://b.example"),
      makeCandidate(3, null, "https://c.example"),
    ];

    const fetchFn = vi.fn((url: string) => {
      if (url === "https://b.example") {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve("ok");
    });

    const bodies = await loadBodiesForShortlist(candidates, { fetchFn });

    expect(bodies.size).toBe(3);
    expect(bodies.get(1)).toBe("ok");
    expect(bodies.get(2)).toBeNull();
    expect(bodies.get(3)).toBe("ok");
  });

  it("never throws even when every fetch fails (REQ-045)", async () => {
    const candidates = [
      makeCandidate(1, null),
      makeCandidate(2, null),
      makeCandidate(3, null),
    ];
    const fetchFn = vi.fn(() => Promise.reject(new Error("total failure")));

    const bodies = await loadBodiesForShortlist(candidates, { fetchFn });

    expect(bodies.size).toBe(3);
    expect(bodies.get(1)).toBeNull();
    expect(bodies.get(2)).toBeNull();
    expect(bodies.get(3)).toBeNull();
  });

  // REQ-043: the default fetchFn must forward the AbortSignal to fetchMarkdown
  it("default fetchFn forwards the AbortSignal to fetchMarkdown", async () => {
    mockFetchMarkdown.mockResolvedValue("body");
    const candidate = makeCandidate(1, null, "https://abort.example/post");

    await loadBodiesForShortlist([candidate], { timeoutMs: 5_000 });

    expect(mockFetchMarkdown).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = mockFetchMarkdown.mock.calls[0] as [
      string,
      { signal?: AbortSignal } | undefined,
    ];
    expect(calledUrl).toBe("https://abort.example/post");
    expect(calledOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs a body_fetch_failed warning with url and error on failure (REQ-046)", async () => {
    const candidate = makeCandidate(
      1,
      null,
      "https://failing.example/article",
    );
    const fetchFn = vi.fn(() => Promise.reject(new Error("kaboom")));

    await loadBodiesForShortlist([candidate], { fetchFn });

    const failureLog = mockLoggerWarn.mock.calls.find(
      (call) => (call[0] as { event?: string }).event === "body_fetch_failed",
    );
    expect(failureLog).toBeDefined();
    const payload = failureLog?.[0] as { url: string; error: string };
    expect(payload.url).toBe("https://failing.example/article");
    expect(payload.error).toContain("kaboom");
  });
});
