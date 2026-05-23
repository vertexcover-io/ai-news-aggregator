import { describe, expect, it } from "vitest";
import { extractPageMetadata } from "@shared/services/page-metadata.js";

describe("extractPageMetadata", () => {
  it("returns title from <title> when nothing else is present", () => {
    const html = `<html><head><title>Foo</title></head><body></body></html>`;
    expect(extractPageMetadata(html, "https://example.com/a")).toEqual({
      title: "Foo",
      author: null,
      year: null,
    });
  });

  it("extracts title, author, and year from JSON-LD Article schema", () => {
    const html = `<html><head>
      <title>Fallback Title</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "JSON-LD Headline",
          "author": { "@type": "Person", "name": "Jane Doe" },
          "datePublished": "2024-06-15T10:00:00Z"
        }
      </script>
    </head></html>`;
    expect(extractPageMetadata(html, "https://example.com/b")).toEqual({
      title: "JSON-LD Headline",
      author: "Jane Doe",
      year: 2024,
    });
  });

  it("extracts metadata from OG / article meta tags when JSON-LD is absent", () => {
    const html = `<html><head>
      <title>Plain Title</title>
      <meta property="og:title" content="OG Title">
      <meta property="article:author" content="John Smith">
      <meta property="article:published_time" content="2023-03-01T00:00:00Z">
    </head></html>`;
    expect(extractPageMetadata(html, "https://example.com/c")).toEqual({
      title: "OG Title",
      author: "John Smith",
      year: 2023,
    });
  });

  it("prefers JSON-LD over OG and <meta> tags when both are present", () => {
    const html = `<html><head>
      <title>Plain</title>
      <meta property="og:title" content="OG Title">
      <meta property="article:author" content="OG Author">
      <meta property="article:published_time" content="2020-01-01T00:00:00Z">
      <meta name="author" content="Meta Author">
      <meta name="date" content="2019-01-01">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "headline": "JSON-LD Wins",
          "author": [{ "@type": "Person", "name": "LD Author" }],
          "datePublished": "2025-12-12"
        }
      </script>
    </head></html>`;
    expect(extractPageMetadata(html, "https://example.com/d")).toEqual({
      title: "JSON-LD Wins",
      author: "LD Author",
      year: 2025,
    });
  });
});
