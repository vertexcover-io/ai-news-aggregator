import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// We import from the module under test. This will fail until convert.ts exists.
import {
  convert,
  isHealthyResult,
} from "@pipeline/services/web-fetch/convert.js";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/web",
);

function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

const BASE_URL = "https://example.com/post";

describe("isHealthyResult", () => {
  it("returns false when textLength is 199", () => {
    const r: ConvertResult = { markdown: "", title: null, byline: null, imageUrl: null, textLength: 199, publishedAt: null, structuredData: null };
    expect(isHealthyResult(r)).toBe(false);
  });

  it("returns true when textLength is exactly 200", () => {
    const r: ConvertResult = { markdown: "", title: null, byline: null, imageUrl: null, textLength: 200, publishedAt: null, structuredData: null };
    expect(isHealthyResult(r)).toBe(true);
  });

  it("returns true when textLength is 201", () => {
    const r: ConvertResult = { markdown: "", title: null, byline: null, imageUrl: null, textLength: 201, publishedAt: null, structuredData: null };
    expect(isHealthyResult(r)).toBe(true);
  });
});

describe("convert — article mode with og:image", () => {
  const html = fixture("article-with-og.html");
  const result = convert({ html, baseUrl: BASE_URL, mode: "article" });

  it("extracts imageUrl from og:image meta tag", () => {
    expect(result.imageUrl).toBe("https://example.com/images/ai-software.jpg");
  });

  it("populates title from Readability", () => {
    expect(result.title).toBeTruthy();
    expect(typeof result.title).toBe("string");
  });

  it("produces non-empty markdown with article content", () => {
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).toContain("AI");
  });

  it("textLength is >= 200 (healthy)", () => {
    expect(result.textLength).toBeGreaterThanOrEqual(200);
    expect(isHealthyResult(result)).toBe(true);
  });

  it("markdown is a string (not HTML)", () => {
    expect(result.markdown).not.toContain("<article>");
    expect(result.markdown).not.toContain("<p>");
  });
});

describe("convert — article mode with twitter:image (no og:image)", () => {
  const html = fixture("article-twitter-image.html");
  const result = convert({ html, baseUrl: "https://example.com/article", mode: "article" });

  it("extracts imageUrl from twitter:image when no og:image present", () => {
    expect(result.imageUrl).toBe("https://example.com/images/llm-future.jpg");
  });

  it("produces non-empty markdown", () => {
    expect(result.textLength).toBeGreaterThan(0);
  });
});

describe("convert — article mode with favicon only (no og/twitter)", () => {
  const html = fixture("article-favicon-only.html");
  const result = convert({ html, baseUrl: "https://example.com/", mode: "article" });

  it("falls back to favicon when no og or twitter image", () => {
    expect(result.imageUrl).toBe("https://example.com/icons/site-icon.png");
  });

  it("produces non-empty markdown", () => {
    expect(result.textLength).toBeGreaterThan(0);
  });
});

describe("convert — article mode where Readability returns null (no article content)", () => {
  const html = fixture("article-empty-readability.html");
  const result = convert({ html, baseUrl: BASE_URL, mode: "article" });

  it("returns empty markdown when Readability returns null", () => {
    expect(result.markdown).toBe("");
  });

  it("returns textLength of 0 when Readability returns null", () => {
    expect(result.textLength).toBe(0);
  });

  it("still extracts imageUrl even when Readability fails", () => {
    // og:image is present in article-empty-readability.html
    expect(result.imageUrl).toBe("https://example.com/images/nav-page.jpg");
  });
});

describe("convert — listing mode", () => {
  const html = fixture("listing-blog-index.html");
  const result = convert({ html, baseUrl: "https://blog.example.com/", mode: "listing" });

  it("includes post URLs in the markdown output", () => {
    expect(result.markdown).toContain("https://blog.example.com/posts/gpt5-benchmark");
    expect(result.markdown).toContain("https://blog.example.com/posts/claude-agents");
    expect(result.markdown).toContain("https://blog.example.com/posts/open-source-llm");
  });

  it("does NOT include nav link text from <nav> in the output", () => {
    // The nav contains 'Archive' and 'About' as standalone link texts
    // These should be stripped since <nav> is removed in listing mode
    const navOnlyText = result.markdown;
    // The fixture nav has links: Home, Archive, About — they should not appear as isolated items
    // We check specifically the aside category links are stripped
    expect(navOnlyText).not.toContain("Categories");
  });

  it("sets byline to null in listing mode", () => {
    expect(result.byline).toBeNull();
  });

  it("returns non-empty markdown", () => {
    expect(result.markdown.length).toBeGreaterThan(0);
  });

  it("extracts imageUrl from original (pre-strip) DOM", () => {
    // The listing fixture has an og:image in the head
    expect(result.imageUrl).toBe("https://blog.example.com/og-listing.jpg");
  });
});

describe("convert — image extraction precedence", () => {
  const htmlWithAll = `<!DOCTYPE html>
<html><head>
  <meta property="og:image" content="https://example.com/og.jpg">
  <meta name="twitter:image" content="https://example.com/tw.jpg">
  <link rel="icon" href="/favicon.ico">
</head><body>
  <article>
    <p>Some content here for Readability to extract successfully so we get a proper result.</p>
    <p>More content to ensure Readability does not return null for this fixture document.</p>
    <p>Additional paragraph to reach enough text to be detected as an article by Mozilla Readability.</p>
  </article>
</body></html>`;

  it("prefers og:image over twitter:image and favicon", () => {
    const result = convert({ html: htmlWithAll, baseUrl: "https://example.com/", mode: "article" });
    expect(result.imageUrl).toBe("https://example.com/og.jpg");
  });
});

describe("convert — base tag resolution", () => {
  const htmlWithBase = `<!DOCTYPE html>
<html><head>
  <base href="https://cdn.example.com/">
  <meta property="og:image" content="/images/hero.jpg">
</head><body>
  <article>
    <p>Some article content that is long enough for Readability to parse successfully.</p>
    <p>Additional paragraph to ensure the article is detected properly by the parser.</p>
    <p>More text here to hit the readability threshold for content detection in articles.</p>
  </article>
</body></html>`;

  it("resolves relative image URLs against the base tag href", () => {
    const result = convert({ html: htmlWithBase, baseUrl: "https://example.com/", mode: "article" });
    expect(result.imageUrl).toBe("https://cdn.example.com/images/hero.jpg");
  });
});

describe("convert — data: URI skipped", () => {
  const htmlDataUri = `<!DOCTYPE html>
<html><head>
  <meta property="og:image" content="data:image/png;base64,abc123">
  <link rel="icon" href="https://example.com/favicon.ico">
</head><body>
  <article>
    <p>Content for Readability to extract.</p>
    <p>Additional paragraph content for article detection by Mozilla Readability library.</p>
    <p>More text to ensure minimum thresholds are reached in the test document.</p>
  </article>
</body></html>`;

  it("skips data: URIs and falls back to next candidate", () => {
    const result = convert({ html: htmlDataUri, baseUrl: "https://example.com/", mode: "article" });
    expect(result.imageUrl).toBe("https://example.com/favicon.ico");
  });
});

describe("convert — no image candidates", () => {
  const htmlNoImage = `<!DOCTYPE html>
<html><head><title>No Image</title></head><body>
  <article>
    <p>Article with no image metadata at all in this document anywhere.</p>
    <p>No og:image, no twitter:image, no favicon link in the document head.</p>
    <p>This is enough text for Readability to extract as a valid article piece.</p>
  </article>
</body></html>`;

  it("returns null imageUrl when no image candidates exist", () => {
    const result = convert({ html: htmlNoImage, baseUrl: "https://example.com/", mode: "article" });
    expect(result.imageUrl).toBeNull();
  });
});

describe("convert — state isolation between consecutive calls", () => {
  it("produces identical results for the same fixture called twice in a row", () => {
    const html = fixture("article-with-og.html");
    const r1 = convert({ html, baseUrl: BASE_URL, mode: "article" });
    const r2 = convert({ html, baseUrl: BASE_URL, mode: "article" });

    expect(r1.markdown).toBe(r2.markdown);
    expect(r1.title).toBe(r2.title);
    expect(r1.byline).toBe(r2.byline);
    expect(r1.imageUrl).toBe(r2.imageUrl);
    expect(r1.textLength).toBe(r2.textLength);
  });

  it("produces identical results for different fixtures called back to back", () => {
    const html1 = fixture("article-with-og.html");
    const html2 = fixture("article-twitter-image.html");

    const first_r1 = convert({ html: html1, baseUrl: BASE_URL, mode: "article" });
    const first_r2 = convert({ html: html2, baseUrl: BASE_URL, mode: "article" });

    // Call again in same order
    const second_r1 = convert({ html: html1, baseUrl: BASE_URL, mode: "article" });
    const second_r2 = convert({ html: html2, baseUrl: BASE_URL, mode: "article" });

    expect(first_r1.imageUrl).toBe(second_r1.imageUrl);
    expect(first_r2.imageUrl).toBe(second_r2.imageUrl);
  });
});

describe("convert — Turndown uses atx headings and GFM", () => {
  const htmlWithHeadings = `<!DOCTYPE html>
<html><head><title>Heading Test</title></head><body>
  <article>
    <h1>Main Heading</h1>
    <p>Some content paragraph that is long enough for Readability to parse.</p>
    <h2>Sub Heading</h2>
    <p>More content in the second section for article detection to succeed.</p>
    <p>Yet more content to ensure enough words for Readability threshold here.</p>
  </article>
</body></html>`;

  it("uses # notation for headings (atx style)", () => {
    const result = convert({ html: htmlWithHeadings, baseUrl: "https://example.com/", mode: "article" });
    expect(result.markdown).toMatch(/^#+ /m);
  });
});

describe("convert resolves relative URLs to absolute against baseUrl", () => {
  const htmlWithRelativeLinks = `<!doctype html><html><head><title>Listing</title></head>
<body>
  <main>
    <a href="/news/post-one">First post</a>
    <a href="/news/post-two">Second post</a>
    <a href="https://other.example/x">External absolute</a>
    <img src="/images/foo.png" alt="foo">
  </main>
</body></html>`;

  it("listing mode emits absolute URLs for relative href and src", () => {
    const result = convert({
      html: htmlWithRelativeLinks,
      baseUrl: "https://example.com/news",
      mode: "listing",
    });
    expect(result.markdown).toContain("https://example.com/news/post-one");
    expect(result.markdown).toContain("https://example.com/news/post-two");
    expect(result.markdown).toContain("https://other.example/x");
    expect(result.markdown).toContain("https://example.com/images/foo.png");
    expect(result.markdown).not.toMatch(/]\(\/news\//);
  });

  const htmlArticleWithRelativeLinks = `<!doctype html><html><head><title>An Article</title></head>
<body>
  <article>
    <h1>Heading One</h1>
    <p>This article body has plenty of words so that Readability accepts it as
    a real article. We need at least a couple of sentences to clear the threshold.
    <a href="/related/post-a">Related post</a> is referenced inline.</p>
    <p>Another paragraph repeats <a href="/related/post-b">another link</a> for
    coverage. Readability should keep both anchors in the parsed content output.</p>
  </article>
</body></html>`;

  it("article mode emits absolute URLs for relative href in Readability output", () => {
    const result = convert({
      html: htmlArticleWithRelativeLinks,
      baseUrl: "https://example.com/blog/post-1",
      mode: "article",
    });
    expect(result.markdown).toContain("https://example.com/related/post-a");
    expect(result.markdown).toContain("https://example.com/related/post-b");
  });
});

// REQ-004: ConvertResult.publishedAt is populated by convert()
describe("convert — REQ-004: publishedAt in ConvertResult", () => {
  it("returns publishedAt with the JSON-LD date for dated-jsonld.html (article mode)", () => {
    const html = fixture("dated-jsonld.html");
    const result = convert({ html, baseUrl: "https://example.com/", mode: "article" });
    expect(result.publishedAt).not.toBeNull();
    expect(result.publishedAt?.toISOString()).toBe("2026-05-25T09:00:00.000Z");
  });

  it("returns publishedAt: null for dated-none.html (article mode)", () => {
    const html = fixture("dated-none.html");
    const result = convert({ html, baseUrl: "https://example.com/", mode: "article" });
    expect(result.publishedAt).toBeNull();
  });

  it("returns publishedAt for dated-jsonld.html even when Readability fails (early return path)", () => {
    // Use a minimal page that would fail Readability but has JSON-LD
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{"@type":"Article","datePublished":"2026-05-25T09:00:00.000Z"}</script>
    </head><body><p>x</p></body></html>`;
    const result = convert({ html, baseUrl: "https://example.com/", mode: "article" });
    // publishedAt should still be set even if Readability returns null
    expect(result.publishedAt).not.toBeNull();
    expect(result.publishedAt?.toISOString()).toBe("2026-05-25T09:00:00.000Z");
  });
});

// REQ-001–004, EDGE-001, EDGE-007: structuredData extraction in listing mode
describe("convert — structuredData: JSON-LD extraction (REQ-001)", () => {
  const html = fixture("listing-jsonld-news.html");
  const result = convert({ html, baseUrl: "https://llm-stats.com/ai-news", mode: "listing" });

  it("structuredData is non-null when ld+json blocks are present", () => {
    expect(result.structuredData).not.toBeNull();
  });

  it("structuredData contains the headline from the first NewsArticle entry", () => {
    expect(result.structuredData).toContain("GPT-5 Achieves New Benchmark Records");
  });

  it("structuredData contains the datePublished from an item entry", () => {
    expect(result.structuredData).toContain("2026-05-26T08:00:00Z");
  });

  it("structuredData contains content from BOTH ld+json blocks", () => {
    // First block: WebSite, Second block: ItemList with NewsArticle entries
    expect(result.structuredData).toContain("LLM Stats");
    expect(result.structuredData).toContain("Open Source LLM Surpasses GPT-4");
  });

  it("structuredData is the raw text (not parsed JSON)", () => {
    // It's a string, not an object
    expect(typeof result.structuredData).toBe("string");
  });
});

describe("convert — structuredData: __next_f extraction (REQ-002)", () => {
  const html = fixture("listing-nextf.html");
  const result = convert({ html, baseUrl: "https://aiweekly.example.com/", mode: "listing" });

  it("structuredData is non-null when self.__next_f.push scripts are present", () => {
    expect(result.structuredData).not.toBeNull();
  });

  it("structuredData includes the self.__next_f.push payload text", () => {
    expect(result.structuredData).toContain("Anthropic Releases Claude 4 with Improved Reasoning");
  });
});

describe("convert — structuredData: __NEXT_DATA__ extraction (REQ-002, EDGE-007)", () => {
  const html = fixture("listing-nextdata.html");
  const result = convert({ html, baseUrl: "https://nextblog.example.com/", mode: "listing" });

  it("structuredData is non-null when __NEXT_DATA__ script is present", () => {
    expect(result.structuredData).not.toBeNull();
  });

  it("structuredData includes the __NEXT_DATA__ JSON text", () => {
    expect(result.structuredData).toContain("Mixture of Experts Scaling Laws Revisited");
  });

  it("structuredData includes the buildId from __NEXT_DATA__", () => {
    expect(result.structuredData).toContain("abc123");
  });
});

describe("convert — structuredData: null when no structured scripts (REQ-004)", () => {
  const html = fixture("listing-plain.html");
  const result = convert({ html, baseUrl: "https://blog.example.com/", mode: "listing" });

  it("structuredData is null for plain anchor-only listing page", () => {
    expect(result.structuredData).toBeNull();
  });
});

describe("convert — structuredData: metadata-only ld+json (EDGE-001, REQ-003)", () => {
  const html = fixture("listing-metadata-only.html");
  const result = convert({ html, baseUrl: "https://therundown.ai/", mode: "listing" });

  it("structuredData is non-null even when ld+json is only WebPage/BreadcrumbList", () => {
    expect(result.structuredData).not.toBeNull();
  });

  it("structuredData contains the WebPage block verbatim", () => {
    expect(result.structuredData).toContain("WebPage");
  });

  it("structuredData contains the BreadcrumbList block verbatim", () => {
    expect(result.structuredData).toContain("BreadcrumbList");
  });

  it("structuredData is raw joined text (no JSON parsing performed)", () => {
    expect(typeof result.structuredData).toBe("string");
    // Should contain the raw ld+json text — not a parsed/stringified version
    expect(result.structuredData).toContain("@context");
  });
});

// REQ-010: listing mode also extracts publishedAt from original DOM (before stripping)
describe("convert — REQ-010: publishedAt in listing mode", () => {
  it("returns publishedAt from JSON-LD in listing mode", () => {
    const html = fixture("dated-jsonld.html");
    const result = convert({ html, baseUrl: "https://example.com/", mode: "listing" });
    expect(result.publishedAt).not.toBeNull();
    expect(result.publishedAt?.toISOString()).toBe("2026-05-25T09:00:00.000Z");
  });

  it("returns publishedAt: null for page with no date in listing mode", () => {
    const html = fixture("dated-none.html");
    const result = convert({ html, baseUrl: "https://example.com/", mode: "listing" });
    expect(result.publishedAt).toBeNull();
  });

  it("extracts publishedAt from head JSON-LD before script tags are stripped in listing mode", () => {
    // In listing mode, <script> tags are stripped — but extraction runs BEFORE stripping
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{"@type":"Article","datePublished":"2026-04-01T00:00:00Z"}</script>
    </head><body>
      <main>
        <a href="https://example.com/post-1">Post one</a>
        <a href="https://example.com/post-2">Post two</a>
        <a href="https://example.com/post-3">Post three</a>
      </main>
    </body></html>`;
    const result = convert({ html, baseUrl: "https://example.com/", mode: "listing" });
    // publishedAt should be captured before stripping removed the script
    expect(result.publishedAt).not.toBeNull();
    expect(result.publishedAt?.getFullYear()).toBe(2026);
    expect(result.publishedAt?.getMonth()).toBe(3); // April = index 3
  });
});
