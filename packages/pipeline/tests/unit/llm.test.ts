import { describe, it, expect, vi } from "vitest";
import {
  createGeminiClient,
  truncateHtml,
  extractArticleSelectors,
} from "@pipeline/llm.js";
import type { GeminiClient } from "@pipeline/llm.js";

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
  it("throws if apiKey is empty string", () => {
    expect(() => createGeminiClient("")).toThrow("GEMINI_API_KEY");
  });

  it("throws if apiKey is whitespace-only", () => {
    expect(() => createGeminiClient("   ")).toThrow("GEMINI_API_KEY");
  });

  it("returns a GeminiClient for a valid key", () => {
    const client = createGeminiClient("valid-key");
    expect(client).toBeDefined();
    expect(typeof client.generateContent).toBe("function");
  });
});

describe("truncateHtml", () => {
  it("returns HTML with scripts, styles, nav, header, footer, svg, comments stripped", () => {
    const html = '<nav>menu</nav><header>hdr</header><div>content</div><script>alert("bad")</script><style>body{color:red}</style><footer>ft</footer><svg><path/></svg><!-- comment --><p>more</p>';
    const result = truncateHtml(html);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<style");
    expect(result).not.toContain("<nav");
    expect(result).toContain("<header");
    expect(result).not.toContain("<footer");
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("<!-- comment -->");
    expect(result).toContain("content");
    expect(result).toContain("more");
  });

  it("returns clean HTML unchanged", () => {
    const shortHtml = "<div>Hello</div>";
    expect(truncateHtml(shortHtml)).toBe(shortHtml);
  });
});

describe("extractArticleSelectors", () => {
  it("returns title, content, author, and date selectors", async () => {
    const client = createMockClient([
      JSON.stringify({
        title: "h1.title",
        content: "div.body",
        author: "span.author",
        date: "time.published",
      }),
    ]);
    const result = await extractArticleSelectors("<html><body></body></html>", client);
    expect(result).toEqual({
      title: "h1.title",
      content: "div.body",
      author: "span.author",
      date: "time.published",
    });
  });

  it("allows null author and date fields", async () => {
    const client = createMockClient([
      JSON.stringify({
        title: "h1",
        content: "article",
        author: null,
        date: null,
      }),
    ]);
    const result = await extractArticleSelectors("<html></html>", client);
    expect(result.title).toBe("h1");
    expect(result.content).toBe("article");
    expect(result.author).toBeUndefined();
    expect(result.date).toBeUndefined();
  });

  it("throws on invalid JSON from LLM", async () => {
    const client = createMockClient(["not valid json at all"]);
    await expect(
      extractArticleSelectors("<html></html>", client),
    ).rejects.toThrow("Failed to parse");
  });

  it("throws when response missing title", async () => {
    const client = createMockClient([
      JSON.stringify({ content: "div", author: null, date: null }),
    ]);
    await expect(
      extractArticleSelectors("<html></html>", client),
    ).rejects.toThrow("title");
  });

  it("throws when response missing content", async () => {
    const client = createMockClient([
      JSON.stringify({ title: "h1", author: null, date: null }),
    ]);
    await expect(
      extractArticleSelectors("<html></html>", client),
    ).rejects.toThrow("content");
  });

  it("propagates Gemini API errors", async () => {
    const client: GeminiClient = {
      generateContent: vi.fn().mockRejectedValue(new Error("API rate limit")),
    };
    await expect(
      extractArticleSelectors("<html></html>", client),
    ).rejects.toThrow("API rate limit");
  });

  it("throws when Gemini returns undefined text", async () => {
    const client = createMockClient([undefined]);
    await expect(
      extractArticleSelectors("<html></html>", client),
    ).rejects.toThrow("empty response");
  });

  it("strips junk HTML before sending to Gemini", async () => {
    const longHtml = "<script>" + "a".repeat(5000) + "</script><nav>menu</nav><div>content</div>";
    const client = createMockClient([
      JSON.stringify({ title: "h1", content: "p", author: null, date: null }),
    ]);
    await extractArticleSelectors(longHtml, client);
    const prompt = (client.generateContent as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(prompt).not.toContain("<script");
    expect(prompt).not.toContain("<nav");
    expect(prompt).toContain("content");
  });

  it("extracts JSON from markdown code blocks", async () => {
    const client = createMockClient([
      '```json\n{"title": "h1", "content": "article", "author": null, "date": null}\n```',
    ]);
    const result = await extractArticleSelectors("<html></html>", client);
    expect(result.title).toBe("h1");
    expect(result.content).toBe("article");
  });
});
