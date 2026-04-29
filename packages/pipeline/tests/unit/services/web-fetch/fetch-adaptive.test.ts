import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";

// Mock fetch-static and fetch-browser before importing fetch-adaptive
vi.mock("@pipeline/services/web-fetch/fetch-static.js", () => ({
  fetchStatic: vi.fn(),
}));

vi.mock("@pipeline/services/web-fetch/fetch-browser.js", () => ({
  fetchBrowser: vi.fn(),
}));

const { fetchAdaptive } = await import(
  "@pipeline/services/web-fetch/fetch-adaptive.js"
);
const { fetchStatic } = await import(
  "@pipeline/services/web-fetch/fetch-static.js"
);
const { fetchBrowser } = await import(
  "@pipeline/services/web-fetch/fetch-browser.js"
);

const HEALTHY_RESULT: ConvertResult = {
  markdown: "# Article content with plenty of text to be healthy",
  title: "Article",
  byline: null,
  imageUrl: null,
  textLength: 300,
};

const UNHEALTHY_RESULT: ConvertResult = {
  markdown: "short",
  title: null,
  byline: null,
  imageUrl: null,
  textLength: 5,
};

const BROWSER_RESULT: ConvertResult = {
  markdown: "# Browser-rendered content",
  title: "Browser Title",
  byline: null,
  imageUrl: null,
  textLength: 400,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("fetchAdaptive", () => {
  it("returns static result when it is healthy (browser NOT called)", async () => {
    vi.mocked(fetchStatic).mockResolvedValue(HEALTHY_RESULT);

    const result = await fetchAdaptive("https://example.com/post", "article");

    expect(fetchStatic).toHaveBeenCalledOnce();
    expect(fetchBrowser).not.toHaveBeenCalled();
    expect(result).toEqual(HEALTHY_RESULT);
  });

  it("falls back to browser when static result is unhealthy", async () => {
    vi.mocked(fetchStatic).mockResolvedValue(UNHEALTHY_RESULT);
    vi.mocked(fetchBrowser).mockResolvedValue(BROWSER_RESULT);

    const result = await fetchAdaptive("https://example.com/post", "article");

    expect(fetchStatic).toHaveBeenCalledOnce();
    expect(fetchBrowser).toHaveBeenCalledOnce();
    expect(result).toEqual(BROWSER_RESULT);
  });

  it("falls back to browser when static throws a non-abort error", async () => {
    vi.mocked(fetchStatic).mockRejectedValue(new Error("HTTP 503 for https://example.com/post"));
    vi.mocked(fetchBrowser).mockResolvedValue(BROWSER_RESULT);

    const result = await fetchAdaptive("https://example.com/post", "article");

    expect(fetchStatic).toHaveBeenCalledOnce();
    expect(fetchBrowser).toHaveBeenCalledOnce();
    expect(result).toEqual(BROWSER_RESULT);
  });

  it("propagates abort and does NOT call browser when signal is aborted", async () => {
    const ac = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    ac.abort(abortError);

    vi.mocked(fetchStatic).mockRejectedValue(abortError);

    await expect(
      fetchAdaptive("https://example.com/post", "article", { signal: ac.signal }),
    ).rejects.toThrow("aborted");

    expect(fetchBrowser).not.toHaveBeenCalled();
  });

  it("propagates browser failure to caller", async () => {
    vi.mocked(fetchStatic).mockResolvedValue(UNHEALTHY_RESULT);
    vi.mocked(fetchBrowser).mockRejectedValue(new Error("browser crashed"));

    await expect(
      fetchAdaptive("https://example.com/post", "article"),
    ).rejects.toThrow("browser crashed");
  });
});
