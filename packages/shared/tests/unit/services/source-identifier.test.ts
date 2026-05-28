import { describe, expect, it } from "vitest";
import { deriveRawItemIdentifier } from "@shared/services/source-identifier.js";
import { SOURCE_TYPE_ORDER, SOURCE_TYPE_SECTION_LABELS } from "@shared/constants/sources.js";
import type { SourceType } from "@shared/db/schema.js";

interface Case {
  readonly name: string;
  readonly sourceType: SourceType;
  readonly url: string | null;
  readonly sourceUrl?: string | null;
  readonly metadata?: { readonly query?: string } | null;
  readonly expected: string;
}

const cases: readonly Case[] = [
  { name: "hn item URL", sourceType: "hn", url: "https://news.ycombinator.com/item?id=1", expected: "news.ycombinator.com" },
  { name: "hn malformed URL still constant", sourceType: "hn", url: "not a url", expected: "news.ycombinator.com" },
  { name: "reddit canonical", sourceType: "reddit", url: "https://reddit.com/r/LocalLLaMA/comments/abc/", expected: "r/LocalLLaMA" },
  { name: "reddit www host", sourceType: "reddit", url: "https://www.reddit.com/r/MachineLearning/comments/xyz/", expected: "r/MachineLearning" },
  { name: "reddit malformed falls back to hostname", sourceType: "reddit", url: "https://example.com/no-r-prefix", expected: "example.com" },
  { name: "reddit garbage falls back to unknown", sourceType: "reddit", url: "https://garbage", expected: "garbage" },
  { name: "twitter x.com", sourceType: "twitter", url: "https://x.com/karpathy/status/1", expected: "@karpathy" },
  { name: "twitter twitter.com", sourceType: "twitter", url: "https://twitter.com/simonw/status/1", expected: "@simonw" },
  { name: "twitter malformed falls back to hostname", sourceType: "twitter", url: "https://x.com/karpathy", expected: "x.com" },
  { name: "rss with www", sourceType: "rss", url: "https://www.example.com/feed", expected: "example.com" },
  { name: "rss plain host", sourceType: "rss", url: "https://example.com/feed", expected: "example.com" },
  { name: "blog with www", sourceType: "blog", url: "https://www.anthropic.com/engineering/post", expected: "anthropic.com" },
  { name: "blog uppercase host lowered", sourceType: "blog", url: "https://BLOG.OpenAI.com/post", expected: "blog.openai.com" },
  { name: "github owner/repo", sourceType: "github", url: "https://github.com/anthropics/claude-code/blob/main/x.py", expected: "anthropics/claude-code" },
  { name: "github case preserved", sourceType: "github", url: "https://github.com/Vercel/Next.js", expected: "Vercel/Next.js" },
  { name: "github malformed falls back to hostname", sourceType: "github", url: "https://github.com/", expected: "github.com" },
  { name: "newsletter host", sourceType: "newsletter", url: "https://latent.space", expected: "latent.space" },
  { name: "web_search no metadata falls back to constant", sourceType: "web_search", url: "https://anything", expected: "web search" },
  { name: "web_search uses metadata.query when present", sourceType: "web_search", url: "https://anything", metadata: { query: "Claude Code OR Cursor" }, expected: "Claude Code OR Cursor" },
  { name: "web_search blank query falls back to constant", sourceType: "web_search", url: "https://anything", metadata: { query: "   " }, expected: "web search" },
  { name: "blog null URL falls back to sourceUrl", sourceType: "blog", url: null, sourceUrl: "https://example.com/x", expected: "example.com" },
  { name: "blog both null returns unknown", sourceType: "blog", url: null, sourceUrl: null, expected: "unknown" },
  { name: "rss invalid URL returns unknown", sourceType: "rss", url: "not-a-url", sourceUrl: null, expected: "unknown" },
];

describe("deriveRawItemIdentifier", () => {
  for (const c of cases) {
    it(c.name, () => {
      const got = deriveRawItemIdentifier({
        sourceType: c.sourceType,
        url: c.url,
        sourceUrl: c.sourceUrl ?? null,
        metadata: c.metadata ?? null,
      });
      expect(got).toBe(c.expected);
    });
  }
});

describe("SOURCE_TYPE_SECTION_LABELS", () => {
  it("has the expected label per source type", () => {
    expect(SOURCE_TYPE_SECTION_LABELS).toEqual({
      hn: "Hacker News",
      reddit: "Reddit",
      twitter: "X (Twitter)",
      rss: "RSS Feeds",
      github: "GitHub",
      blog: "Engineering Blogs",
      newsletter: "Newsletters",
      web_search: "Web Search",
    });
  });

  it("covers every SOURCE_TYPE_ORDER entry", () => {
    for (const t of SOURCE_TYPE_ORDER) {
      expect(SOURCE_TYPE_SECTION_LABELS[t]).toBeTruthy();
    }
  });

  it("SOURCE_TYPE_ORDER is in the expected fixed order", () => {
    expect(SOURCE_TYPE_ORDER).toEqual([
      "hn",
      "reddit",
      "twitter",
      "rss",
      "github",
      "blog",
      "newsletter",
      "web_search",
    ]);
  });
});
