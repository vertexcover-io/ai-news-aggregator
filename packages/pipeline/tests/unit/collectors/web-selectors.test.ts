import { describe, it, expect, vi } from "vitest";
import {
  createGeminiClient,
  truncateHtml,
  extractSelectors,
  deriveSelectors,
} from "@pipeline/collectors/web-selectors.js";
import type { GeminiClient } from "@pipeline/collectors/web-selectors.js";

function createMockClient(responses: (string | undefined)[]): GeminiClient {
  let callIndex = 0;
  return {
    generateContent: vi.fn().mockImplementation(() => {
      const text = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve({ text });
    }),
  };
}

describe("createGeminiClient", () => {
  // REQ-010: Missing GEMINI_API_KEY throws error
  it("throws if apiKey is empty string", () => {
    expect(() => createGeminiClient("")).toThrow("GEMINI_API_KEY");
  });

  // EDGE-008: Empty API key string
  it("throws if apiKey is whitespace-only", () => {
    expect(() => createGeminiClient("   ")).toThrow("GEMINI_API_KEY");
  });

  // REQ-010: Valid key returns a client
  it("returns a GeminiClient for a valid key", () => {
    const client = createGeminiClient("valid-key");
    expect(client).toBeDefined();
    expect(typeof client.generateContent).toBe("function");
  });
});

describe("truncateHtml", () => {
  // REQ-002: HTML is truncated to 15000 chars
  it("truncates HTML longer than 15000 chars", () => {
    const longHtml = "<div>" + "a".repeat(20000) + "</div>";
    const result = truncateHtml(longHtml);
    expect(result.length).toBeLessThanOrEqual(15000);
  });

  // EDGE-004: Short HTML sent as-is
  it("returns short HTML unchanged", () => {
    const shortHtml = "<div>Hello</div>";
    expect(truncateHtml(shortHtml)).toBe(shortHtml);
  });

  it("strips script tags before truncating", () => {
    const html = '<div>content</div><script>alert("bad")</script><p>more</p>';
    const result = truncateHtml(html);
    expect(result).not.toContain("<script");
    expect(result).toContain("content");
    expect(result).toContain("more");
  });

  it("strips style tags before truncating", () => {
    const html = "<style>body{color:red}</style><div>content</div>";
    const result = truncateHtml(html);
    expect(result).not.toContain("<style");
    expect(result).toContain("content");
  });

  it("respects custom maxLength", () => {
    const html = "<div>" + "x".repeat(200) + "</div>";
    const result = truncateHtml(html, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });
});

describe("extractSelectors", () => {
  // REQ-001: Returns valid WebSourceSelectors from mocked Gemini response (index)
  it("returns articleLink selector for index context", async () => {
    const client = createMockClient([
      JSON.stringify({ articleLink: "a.post-link" }),
    ]);
    const result = await extractSelectors("<html><body></body></html>", "index", client);
    expect(result).toEqual({ articleLink: "a.post-link" });
  });

  // REQ-001: Returns valid WebSourceSelectors from mocked Gemini response (article)
  it("returns article selectors for article context", async () => {
    const client = createMockClient([
      JSON.stringify({
        title: "h1.title",
        content: "div.body",
        author: "span.author",
        date: "time.published",
      }),
    ]);
    const result = await extractSelectors("<html><body></body></html>", "article", client);
    expect(result).toEqual({
      title: "h1.title",
      content: "div.body",
      author: "span.author",
      date: "time.published",
    });
  });

  // EDGE-001: null author/date in response
  it("allows null author and date fields", async () => {
    const client = createMockClient([
      JSON.stringify({
        title: "h1",
        content: "article",
        author: null,
        date: null,
      }),
    ]);
    const result = await extractSelectors("<html></html>", "article", client);
    expect(result).toEqual({
      title: "h1",
      content: "article",
      author: null,
      date: null,
    });
  });

  // REQ-003: Invalid JSON from LLM throws error
  it("throws on invalid JSON from LLM", async () => {
    const client = createMockClient(["not valid json at all"]);
    await expect(
      extractSelectors("<html></html>", "index", client),
    ).rejects.toThrow("Failed to parse");
  });

  // EDGE-003: Malformed JSON from LLM
  it("throws on partial/malformed JSON", async () => {
    const client = createMockClient(['{"articleLink": ']);
    await expect(
      extractSelectors("<html></html>", "index", client),
    ).rejects.toThrow("Failed to parse");
  });

  // REQ-003: Missing required fields throw error
  it("throws when index response missing articleLink", async () => {
    const client = createMockClient([JSON.stringify({ title: "h1" })]);
    await expect(
      extractSelectors("<html></html>", "index", client),
    ).rejects.toThrow("articleLink");
  });

  it("throws when article response missing title", async () => {
    const client = createMockClient([
      JSON.stringify({ content: "div", author: null, date: null }),
    ]);
    await expect(
      extractSelectors("<html></html>", "article", client),
    ).rejects.toThrow("title");
  });

  it("throws when article response missing content", async () => {
    const client = createMockClient([
      JSON.stringify({ title: "h1", author: null, date: null }),
    ]);
    await expect(
      extractSelectors("<html></html>", "article", client),
    ).rejects.toThrow("content");
  });

  // REQ-008: Gemini API failure throws error
  it("propagates Gemini API errors", async () => {
    const client: GeminiClient = {
      generateContent: vi.fn().mockRejectedValue(new Error("API rate limit")),
    };
    await expect(
      extractSelectors("<html></html>", "index", client),
    ).rejects.toThrow("API rate limit");
  });

  // REQ-008: undefined text from Gemini throws
  it("throws when Gemini returns undefined text", async () => {
    const client = createMockClient([undefined]);
    await expect(
      extractSelectors("<html></html>", "index", client),
    ).rejects.toThrow("empty response");
  });

  // REQ-002: HTML sent to Gemini is truncated
  it("truncates HTML before sending to Gemini", async () => {
    const longHtml = "<div>" + "a".repeat(20000) + "</div>";
    const client = createMockClient([
      JSON.stringify({ articleLink: "a.link" }),
    ]);
    await extractSelectors(longHtml, "index", client);
    const prompt = (client.generateContent as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(prompt.length).toBeLessThan(longHtml.length);
  });

  // Handles markdown-wrapped JSON responses
  it("extracts JSON from markdown code blocks", async () => {
    const client = createMockClient([
      '```json\n{"articleLink": "a.post-link"}\n```',
    ]);
    const result = await extractSelectors("<html></html>", "index", client);
    expect(result).toEqual({ articleLink: "a.post-link" });
  });
});

describe("deriveSelectors", () => {
  // REQ-013: Calls extractSelectors twice - index first, then article
  it("calls Gemini twice and merges index + article selectors", async () => {
    const client = createMockClient([
      JSON.stringify({ articleLink: "a.post" }),
      JSON.stringify({
        title: "h1",
        content: "div.content",
        author: "span.author",
        date: "time",
      }),
    ]);

    const result = await deriveSelectors("<html>index</html>", "<html>article</html>", client);

    expect(result).toEqual({
      articleLink: "a.post",
      title: "h1",
      content: "div.content",
      author: "span.author",
      date: "time",
    });

    const generateContent = client.generateContent as ReturnType<typeof vi.fn>;
    expect(generateContent).toHaveBeenCalledTimes(2);
    // First call should be about index page
    expect(generateContent.mock.calls[0][0]).toContain("index");
    // Second call should be about article page
    expect(generateContent.mock.calls[1][0]).toContain("article");
  });

  // EDGE-001: null author/date from article extraction
  it("merges with null optional fields", async () => {
    const client = createMockClient([
      JSON.stringify({ articleLink: "a" }),
      JSON.stringify({ title: "h1", content: "main", author: null, date: null }),
    ]);

    const result = await deriveSelectors("<html>idx</html>", "<html>art</html>", client);
    expect(result.author).toBeUndefined();
    expect(result.date).toBeUndefined();
  });

  // REQ-008: First LLM call fails
  it("propagates error from index extraction failure", async () => {
    const client: GeminiClient = {
      generateContent: vi.fn().mockRejectedValue(new Error("network down")),
    };
    await expect(
      deriveSelectors("<html></html>", "<html></html>", client),
    ).rejects.toThrow("network down");
  });
});
