import { describe, expect, it } from "vitest";
import type { EnrichedLinkContent, RawItemInsert } from "@newsletter/shared";
import {
  canonicalizeEnrichmentUrl,
  shouldEnrich,
} from "@pipeline/services/link-enrichment/url-classifier.js";

function makeItem(overrides: Partial<RawItemInsert>): RawItemInsert {
  return {
    sourceType: "reddit",
    externalId: "x",
    title: "t",
    url: "",
    ...overrides,
  } as RawItemInsert;
}

describe("canonicalizeEnrichmentUrl", () => {
  it("returns null for invalid URLs (VS-8)", () => {
    expect(canonicalizeEnrichmentUrl("not-a-url")).toBeNull();
    expect(canonicalizeEnrichmentUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeEnrichmentUrl("mailto:x@y.z")).toBeNull();
    expect(canonicalizeEnrichmentUrl("ftp://example.com")).toBeNull();
  });

  it("lowercases hostname, drops fragment, strips tracking params", () => {
    const out = canonicalizeEnrichmentUrl(
      "https://Example.com/path?utm_source=x&keep=1&fbclid=abc#frag",
    );
    expect(out).toBe("https://example.com/path?keep=1");
  });

  it("strips mc_cid, mc_eid, ref, source params", () => {
    const out = canonicalizeEnrichmentUrl(
      "https://example.com/a?mc_cid=1&mc_eid=2&ref=foo&source=bar&x=keep",
    );
    expect(out).toBe("https://example.com/a?x=keep");
  });
});

describe("shouldEnrich", () => {
  const cache = new Map<string, EnrichedLinkContent>();

  it("returns no-url for self-post (url === sourceUrl) (VS-1)", () => {
    const result = shouldEnrich(
      makeItem({ url: "https://reddit.com/r/x/p", sourceUrl: "https://reddit.com/r/x/p" }),
      cache,
    );
    expect(result).toEqual({ enrich: false, skipReason: "no-url" });
  });

  it("returns no-url for empty url", () => {
    const result = shouldEnrich(makeItem({ url: "" }), cache);
    expect(result.enrich).toBe(false);
    if (!result.enrich) expect(result.skipReason).toBe("no-url");
  });

  it("returns invalid-url for non-http schemes (VS-8)", () => {
    for (const u of ["javascript:alert(1)", "mailto:x@y.z", "not-a-url", "ftp://example.com"]) {
      const r = shouldEnrich(makeItem({ url: u }), cache);
      expect(r.enrich).toBe(false);
      if (!r.enrich) expect(r.skipReason).toBe("invalid-url");
    }
  });

  it("returns invalid-url for private, loopback, and link-local hosts (SSRF guard)", () => {
    for (const u of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://172.17.0.2/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
    ]) {
      const r = shouldEnrich(makeItem({ url: u }), cache);
      expect(r.enrich).toBe(false);
      if (!r.enrich) expect(r.skipReason).toBe("invalid-url");
    }
  });

  it("returns same-platform for reddit/x/hn/t.co hosts", () => {
    for (const u of [
      "https://reddit.com/r/x",
      "https://www.reddit.com/r/x",
      "https://news.ycombinator.com/item?id=1",
      "https://x.com/foo/status/1",
      "https://t.co/abc",
    ]) {
      const r = shouldEnrich(makeItem({ url: u }), cache);
      expect(r.enrich).toBe(false);
      if (!r.enrich) expect(r.skipReason).toBe("same-platform");
    }
  });

  it("returns non-html-media for media extensions and hosts (VS-5)", () => {
    for (const u of [
      "https://example.com/paper.pdf",
      "https://example.com/img.PNG",
      "https://youtube.com/watch?v=abc",
      "https://youtu.be/abc",
      "https://i.imgur.com/x.jpg",
    ]) {
      const r = shouldEnrich(makeItem({ url: u }), cache);
      expect(r.enrich).toBe(false);
      if (!r.enrich) expect(r.skipReason).toBe("non-html-media");
    }
  });

  it("returns cache-hit when canonical present in cache", () => {
    const c = new Map<string, EnrichedLinkContent>();
    c.set("https://example.com/article", {
      url: "https://example.com/article",
      fetchedAt: "2026-01-01T00:00:00Z",
      status: "ok",
    });
    const r = shouldEnrich(makeItem({ url: "https://example.com/article" }), c);
    expect(r.enrich).toBe(false);
    if (!r.enrich) {
      expect(r.skipReason).toBe("cache-hit");
      expect(r.canonical).toBe("https://example.com/article");
    }
  });

  it("returns enrich:true with canonical for fresh enrichable URL", () => {
    const r = shouldEnrich(
      makeItem({ url: "https://Example.com/article?utm_source=foo" }),
      new Map(),
    );
    expect(r.enrich).toBe(true);
    if (r.enrich) expect(r.canonical).toBe("https://example.com/article");
  });
});
