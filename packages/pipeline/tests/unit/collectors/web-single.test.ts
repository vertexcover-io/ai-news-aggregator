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

import { fetchWebPost } from "@pipeline/collectors/web.js";

describe("fetchWebPost", () => {
  it("fetches markdown body and returns a RawItemInsert", async () => {
    const fetchMarkdown = vi.fn((url: string) =>
      Promise.resolve(`# Title\n\nBody about ${url}`),
    );
    const result = await fetchWebPost("https://example.com/post", {
      fetchMarkdownFn: fetchMarkdown,
    });
    expect(result.sourceType).toBe("blog");
    expect(result.url).toBe("https://example.com/post");
    expect(result.title).toBe("Title");
    expect(result.content).toContain("Body about https://example.com/post");
    expect(result.externalId).toBeTruthy();
    expect(fetchMarkdown).toHaveBeenCalledWith(
      "https://example.com/post",
      expect.anything(),
    );
  });

  it("propagates fetch failures", async () => {
    const fetchMarkdown = vi.fn(() => Promise.reject(new Error("timeout")));
    await expect(
      fetchWebPost("https://example.com/post", { fetchMarkdownFn: fetchMarkdown }),
    ).rejects.toThrow(/timeout/);
  });

  it("forwards AbortSignal to fetchMarkdown", async () => {
    const ac = new AbortController();
    const fetchMarkdown = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      expect(opts?.signal).toBe(ac.signal);
      return Promise.resolve("# x\n\nbody");
    });
    await fetchWebPost("https://example.com/post", {
      fetchMarkdownFn: fetchMarkdown,
      signal: ac.signal,
    });
  });

  it("forwards fetchFn to fetchMarkdown", async () => {
    const customFetch = vi.fn() as unknown as typeof fetch;
    const fetchMarkdown = vi.fn(
      (_url: string, opts?: { fetchFn?: typeof fetch }) => {
        expect(opts?.fetchFn).toBe(customFetch);
        return Promise.resolve("# x\n\nbody");
      },
    );
    await fetchWebPost("https://example.com/post", {
      fetchMarkdownFn: fetchMarkdown,
      fetchFn: customFetch,
    });
  });

  it("uses URL path as title when markdown has no heading", async () => {
    const fetchMarkdown = vi.fn(() => Promise.resolve("just body text no heading"));
    const result = await fetchWebPost("https://example.com/interesting-post", {
      fetchMarkdownFn: fetchMarkdown,
    });
    expect(result.title).toBeTruthy();
  });
});
