import { describe, it, expect } from "vitest";
import { extractFallbackImage } from "@pipeline/collectors/web.js";

// EDGE-031: JS-rendered pages return no image, by design — no automated test

describe("extractFallbackImage", () => {
  // REQ-032
  it("returns og:image URL from meta property tag", () => {
    const html = `<html><head><meta property="og:image" content="https://x.com/og.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/og.png");
  });

  // REQ-033
  it("returns twitter:image URL from meta name tag", () => {
    const html = `<html><head><meta name="twitter:image" content="https://x.com/tw.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/tw.png");
  });

  // REQ-033
  it("returns twitter:image:src URL from meta name tag", () => {
    const html = `<html><head><meta name="twitter:image:src" content="https://x.com/tw.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/tw.png");
  });

  // REQ-034
  it("returns favicon URL from link rel=icon", () => {
    const html = `<html><head><link rel="icon" href="/favicon.ico"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com/blog/post")).toBe("https://x.com/favicon.ico");
  });

  // REQ-034
  it("returns favicon URL from link rel='shortcut icon'", () => {
    const html = `<html><head><link rel="shortcut icon" href="/favicon.ico"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com/blog/post")).toBe("https://x.com/favicon.ico");
  });

  // REQ-035: relative URL resolves against base
  it("resolves relative /foo.png against the origin", () => {
    const html = `<html><head><meta property="og:image" content="/foo.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com/blog/post")).toBe("https://x.com/foo.png");
  });

  // REQ-035: <base href> overrides baseUrl
  it("uses <base href> to resolve relative URLs", () => {
    const html = `<html><head><base href="https://cdn.x.com/"><meta property="og:image" content="images/og.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://cdn.x.com/images/og.png");
  });

  // REQ-036: data: URI in og:image is skipped, falls back to twitter:image
  it("skips data: URI in og:image and falls back to twitter:image", () => {
    const html = `<html><head><meta property="og:image" content="data:image/png;base64,abc"><meta name="twitter:image" content="https://x.com/tw.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/tw.png");
  });

  // REQ-037: ftp: URL in og:image is skipped, fallback continues
  it("skips ftp: URL in og:image and falls back to twitter:image", () => {
    const html = `<html><head><meta property="og:image" content="ftp://files.x.com/og.png"><meta name="twitter:image" content="https://x.com/tw.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/tw.png");
  });

  // REQ-038
  it("returns null when no eligible tags are present", () => {
    const html = `<html><head><title>No images here</title></head><body><p>text</p></body></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBeNull();
  });

  // EDGE-030
  it("returns null when HTML has no <head> tag", () => {
    const html = `<p>Just some content without a head element</p>`;
    expect(extractFallbackImage(html, "https://x.com")).toBeNull();
  });

  // EDGE-032: protocol-relative URL
  it("resolves protocol-relative //cdn.x.com/og.png against HTTPS baseUrl", () => {
    const html = `<html><head><meta property="og:image" content="//cdn.x.com/og.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://cdn.x.com/og.png");
  });

  // EDGE-033: single-quoted attributes
  it("parses single-quoted attribute values correctly", () => {
    const html = `<html><head><meta property='og:image' content='https://x.com/sq.png'></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/sq.png");
  });

  // EDGE-034: &amp; in content decoded
  it("decodes &amp; in og:image content", () => {
    const html = `<html><head><meta property="og:image" content="https://x.com/og.png?a=1&amp;b=2"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/og.png?a=1&b=2");
  });

  // og:image takes priority over twitter:image
  it("prefers og:image over twitter:image when both are present", () => {
    const html = `<html><head><meta property="og:image" content="https://x.com/og.png"><meta name="twitter:image" content="https://x.com/tw.png"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/og.png");
  });

  // og:image and twitter:image take priority over favicon
  it("prefers twitter:image over favicon when og:image is absent", () => {
    const html = `<html><head><meta name="twitter:image" content="https://x.com/tw.png"><link rel="icon" href="/favicon.ico"></head></html>`;
    expect(extractFallbackImage(html, "https://x.com")).toBe("https://x.com/tw.png");
  });
});
