import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";

// Mock fetch-adaptive so index.test.ts doesn't need a real browser
vi.mock("@pipeline/services/web-fetch/fetch-adaptive.js", () => ({
  fetchAdaptive: vi.fn(),
}));

const { fetchMarkdown } = await import("@pipeline/services/web-fetch/index.js");
const { fetchAdaptive } = await import(
  "@pipeline/services/web-fetch/fetch-adaptive.js"
);

const MOCK_RESULT: ConvertResult = {
  markdown: "# The article markdown",
  title: "Article",
  byline: "Jane Doe",
  imageUrl: "https://example.com/image.png",
  textLength: 400,
  publishedAt: null,
  structuredData: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchAdaptive).mockResolvedValue(MOCK_RESULT);
});

describe("fetchMarkdown", () => {
  it("returns the markdown string from the underlying ConvertResult", async () => {
    const result = await fetchMarkdown("https://example.com/post", {
      mode: "article",
    });

    expect(result).toBe("# The article markdown");
  });

  it("calls fetchAdaptive with url, mode, and signal", async () => {
    const ac = new AbortController();

    await fetchMarkdown("https://example.com/post", {
      mode: "listing",
      signal: ac.signal,
    });

    expect(fetchAdaptive).toHaveBeenCalledWith(
      "https://example.com/post",
      "listing",
      { signal: ac.signal },
    );
  });
});
