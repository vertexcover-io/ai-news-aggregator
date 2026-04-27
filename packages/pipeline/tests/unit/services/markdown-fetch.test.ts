import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import jinaEnvelopeFixture from "@pipeline-tests/unit/fixtures/web-jina-envelope.json";

interface FetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}
type MockFetchFn = ReturnType<
  typeof vi.fn<[url: string, init?: RequestInit], Promise<FetchResponse>>
>;

function createMockFetch(
  responses: { ok: boolean; status: number; body: string }[],
): MockFetchFn {
  let callIndex = 0;
  return vi
    .fn<[url: string, init?: RequestInit], Promise<FetchResponse>>()
    .mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      if (!resp) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({
        ok: resp.ok,
        status: resp.status,
        text: () => Promise.resolve(resp.body),
      });
    });
}

type FetchMarkdownFn = (
  url: string,
  options?: { fetchFn?: MockFetchFn; signal?: AbortSignal },
) => Promise<string>;

describe("fetchMarkdown (relocated to services/markdown-fetch)", () => {
  let fetchMarkdown: FetchMarkdownFn;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv("JINA_API_KEY", "");
    const mod = await import("@pipeline/services/markdown-fetch.js");
    fetchMarkdown = mod.fetchMarkdown as FetchMarkdownFn;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  // REQ-100: retry on 429
  it("retries on 429 and returns body on second attempt", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 429, body: "rate limited" },
      { ok: true, status: 200, body: jinaEnvelopeFixture.envelope },
    ]);

    const result = await fetchMarkdown("https://example.com/post", { fetchFn: mockFetch });

    expect(result).toBe(jinaEnvelopeFixture.envelope.trim());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // REQ-043: aborts immediately on signal without exhausting retries
  it("rejects promptly when the AbortSignal fires without exhausting retries", async () => {
    vi.useRealTimers();
    const neverResolveFetch = vi
      .fn<[url: string, init?: RequestInit], Promise<FetchResponse>>()
      .mockImplementation((_url, init) => {
        return new Promise<FetchResponse>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const reason = init.signal?.reason;
            reject(
              reason instanceof Error ? reason : new Error("aborted"),
            );
          });
        });
      });

    const signal = AbortSignal.timeout(50);
    const start = Date.now();
    await expect(
      fetchMarkdown("https://example.com/post", {
        fetchFn: neverResolveFetch,
        signal,
      }),
    ).rejects.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    // Should not have retried 3 times (would take >3s due to backoff delays)
    expect(neverResolveFetch).toHaveBeenCalledTimes(1);
  });

  // REQ-100: retry on 5xx up to MAX_RETRIES then throw
  it("retries on 502 up to MAX_RETRIES then throws", async () => {
    const mockFetch = createMockFetch([
      { ok: false, status: 502, body: "bad gateway" },
      { ok: false, status: 502, body: "bad gateway" },
      { ok: false, status: 502, body: "bad gateway" },
    ]);

    await expect(
      fetchMarkdown("https://example.com/post", { fetchFn: mockFetch }),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Abort path tests
// ---------------------------------------------------------------------------

describe("fetchMarkdown abort paths", () => {
  let fetchMarkdown: FetchMarkdownFn;

  beforeEach(async () => {
    vi.stubEnv("JINA_API_KEY", "");
    const mod = await import("@pipeline/services/markdown-fetch.js");
    fetchMarkdown = mod.fetchMarkdown as FetchMarkdownFn;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("throws immediately when signal is already aborted before call", async () => {
    const ac = new AbortController();
    ac.abort(new Error("pre-aborted"));
    const mockFetch = vi.fn();
    await expect(
      fetchMarkdown("https://example.com", { fetchFn: mockFetch, signal: ac.signal }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when signal is aborted during an in-flight fetch", async () => {
    const ac = new AbortController();
    const mockFetch = vi.fn().mockImplementation(() =>
      new Promise((_res, rej) => {
        ac.signal.addEventListener(
          "abort",
          () => {
            const reason = ac.signal.reason;
            rej(reason instanceof Error ? reason : new Error("aborted"));
          },
          { once: true },
        );
      }),
    );
    const fetchPromise = fetchMarkdown("https://example.com", {
      fetchFn: mockFetch,
      signal: ac.signal,
    });
    ac.abort(new Error("mid-fetch abort"));
    await expect(fetchPromise).rejects.toThrow();
  });
});

describe("delay abort paths", () => {
  let delayFn: (ms: number, signal?: AbortSignal) => Promise<void>;

  beforeEach(async () => {
    const mod = await import("@pipeline/services/markdown-fetch.js");
    delayFn = mod.delay;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delay rejects immediately when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("aborted"));
    await expect(delayFn(1000, ac.signal)).rejects.toThrow();
  });

  it("delay rejects when signal fires during the delay", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = delayFn(5000, ac.signal);
    ac.abort(new Error("fired"));
    await expect(p).rejects.toThrow();
    vi.useRealTimers();
  });
});

// REQ-047: Jina URL string is no longer present in web.ts or rank.ts
describe("REQ-047: Jina URL string isolation", () => {
  const webSrc = readFileSync(
    fileURLToPath(new URL("../../../src/collectors/web.ts", import.meta.url)),
    "utf8",
  );
  const rankSrc = readFileSync(
    fileURLToPath(new URL("../../../src/processors/rank.ts", import.meta.url)),
    "utf8",
  );

  it("web.ts does not contain the Jina URL string", () => {
    expect(webSrc).not.toContain("https://r.jina.ai");
  });

  it("rank.ts does not contain the Jina URL string", () => {
    expect(rankSrc).not.toContain("https://r.jina.ai");
  });
});
