import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

import { extractPublishedAt } from "@pipeline/services/web-fetch/published-date.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/web",
);

function fixtureDoc(name: string): Document {
  const html = readFileSync(join(FIXTURES_DIR, name), "utf8");
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { url: "https://example.com/", virtualConsole: vc });
  return dom.window.document;
}

function makeDoc(html: string): Document {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { url: "https://example.com/", virtualConsole: vc });
  return dom.window.document;
}

// REQ-001: therundown.ai fixture — JSON-LD wins over body-text date
describe("extractPublishedAt — REQ-001: therundown.ai regression", () => {
  it("returns 2026-05-25 from JSON-LD datePublished, NOT the body-text date 2026-05-21", () => {
    const doc = fixtureDoc("dated-jsonld.html");
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(4); // May = index 4
    expect(result?.getDate()).toBe(25);
  });

  it("returns the exact ISO timestamp from JSON-LD", () => {
    const doc = fixtureDoc("dated-jsonld.html");
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-05-25T09:00:00.000Z");
  });
});

// REQ-002: JSON-LD > meta > time precedence
describe("extractPublishedAt — REQ-002: precedence tiers", () => {
  it("prefers JSON-LD over <time> when both present (llm-stats.com fixture)", () => {
    const doc = fixtureDoc("dated-time-element.html");
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    // JSON-LD says 2026-05-19T10:00:00.000Z, <time> says 2026-05-19 — same date, JSON-LD wins
    expect(result?.toISOString()).toBe("2026-05-19T10:00:00.000Z");
  });

  it("uses meta tier when only meta tag present", () => {
    const doc = fixtureDoc("dated-meta.html");
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(4); // May
    expect(result?.getDate()).toBe(10);
  });

  it("uses <time datetime> tier when only time element present", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head><title>T</title></head><body>
      <article>
        <time datetime="2026-04-15T12:00:00Z">April 15</time>
        <p>content here for the test document body element children</p>
      </article>
    </body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(3); // April = index 3
    expect(result?.getDate()).toBe(15);
  });

  it("prefers JSON-LD over meta when both present", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <meta property="article:published_time" content="2026-03-01T00:00:00Z">
      <script type="application/ld+json">
      {"@type":"Article","datePublished":"2026-03-05T00:00:00Z"}
      </script>
    </head><body><article><p>text content for body</p></article></body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(5); // JSON-LD wins (March 5), not March 1
  });

  it("prefers meta over <time> when JSON-LD absent", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <meta property="article:published_time" content="2026-03-10T00:00:00Z">
    </head><body><article>
      <time datetime="2026-03-01">March 1</time>
      <p>body text content</p>
    </article></body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(10); // meta wins (March 10), not March 1
  });
});

// REQ-003: JSON-LD shapes — object, array, @graph
describe("extractPublishedAt — REQ-003: JSON-LD shapes", () => {
  it("handles single JSON-LD object", () => {
    const doc = fixtureDoc("dated-jsonld.html");
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-05-25T09:00:00.000Z");
  });

  it("handles JSON-LD array of nodes", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      [
        {"@type":"BreadcrumbList","name":"Nav"},
        {"@type":"Article","datePublished":"2026-06-01T00:00:00Z"}
      ]
      </script>
    </head><body><article><p>body text here</p></article></body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(5); // June = index 5
    expect(result?.getDate()).toBe(1);
  });

  it("handles JSON-LD @graph array (dated-graph.html fixture)", () => {
    const doc = fixtureDoc("dated-graph.html");
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-05-15T08:00:00.000Z");
  });

  it("handles @graph where first node lacks datePublished — EDGE-007", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "WebSite", "name": "Site"},
          {"@type": "BlogPosting", "datePublished": "2026-07-04T00:00:00Z"}
        ]
      }
      </script>
    </head><body><article><p>body text</p></article></body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getMonth()).toBe(6); // July = index 6
    expect(result?.getDate()).toBe(4);
  });
});

// EDGE-001: malformed JSON-LD — skip silently, no throw
describe("extractPublishedAt — EDGE-001: malformed JSON-LD", () => {
  it("skips malformed JSON-LD block and continues to next tier", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <script type="application/ld+json">{ invalid json !!! </script>
      <meta property="article:published_time" content="2026-02-14T00:00:00Z">
    </head><body><article><p>body text content</p></article></body></html>`);
    expect(() => extractPublishedAt(doc)).not.toThrow();
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getMonth()).toBe(1); // February = index 1
    expect(result?.getDate()).toBe(14);
  });

  it("returns null when only JSON-LD block is malformed and no other signals", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <script type="application/ld+json">{ bad json</script>
    </head><body><article><p>body text</p></article></body></html>`);
    expect(() => extractPublishedAt(doc)).not.toThrow();
    expect(extractPublishedAt(doc)).toBeNull();
  });
});

// EDGE-002: non-ISO datePublished string
describe("extractPublishedAt — EDGE-002: non-ISO datePublished", () => {
  it("parses a human-readable date string in datePublished if native Date accepts it", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      {"@type":"Article","datePublished":"May 25, 2026"}
      </script>
    </head><body><article><p>body text</p></article></body></html>`);
    const result = extractPublishedAt(doc);
    // "May 25, 2026" is parseable by native Date in most environments
    if (result !== null) {
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(4); // May
      expect(result.getDate()).toBe(25);
    }
    // null is also acceptable per EDGE-002: treat tier as absent, fall through
    // The key requirement is: no throw
    expect(() => extractPublishedAt(doc)).not.toThrow();
  });

  it("falls through to next tier when datePublished is unparseable garbage", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      {"@type":"Article","datePublished":"not-a-date-at-all-xyz"}
      </script>
      <meta property="article:published_time" content="2026-01-20T00:00:00Z">
    </head><body><article><p>body text</p></article></body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getMonth()).toBe(0); // January = index 0
    expect(result?.getDate()).toBe(20);
  });
});

// EDGE-003: <time> with no datetime attribute — skip
describe("extractPublishedAt — EDGE-003: <time> without datetime attribute", () => {
  it("skips <time> elements without a datetime attribute", () => {
    const doc = makeDoc(`<!DOCTYPE html><html><head><title>T</title></head><body>
      <article>
        <time>May 25, 2026</time>
        <p>body text content here for the article element body</p>
      </article>
    </body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).toBeNull();
  });
});

// EDGE-010: alternate meta selectors
describe("extractPublishedAt — EDGE-010: alternate meta selectors", () => {
  it.each([
    { selector: "og:published_time", metaTag: `<meta property="og:published_time" content="2026-08-01T00:00:00Z">`, month: 7, date: 1 },
    { selector: "meta[itemprop=datePublished]", metaTag: `<meta itemprop="datePublished" content="2026-09-15T00:00:00Z">`, month: 8, date: 15 },
    { selector: "meta[name=parsely-pub-date]", metaTag: `<meta name="parsely-pub-date" content="2026-10-31T00:00:00Z">`, month: 9, date: 31 },
    { selector: "meta[name=date]", metaTag: `<meta name="date" content="2026-11-11T00:00:00Z">`, month: 10, date: 11 },
    { selector: "meta[name=dc.date.issued]", metaTag: `<meta name="dc.date.issued" content="2026-12-25T00:00:00Z">`, month: 11, date: 25 },
  ])("matches $selector", ({ metaTag, month, date }) => {
    const doc = makeDoc(`<!DOCTYPE html><html><head>
      ${metaTag}
    </head><body><article><p>body text</p></article></body></html>`);
    const result = extractPublishedAt(doc);
    expect(result).not.toBeNull();
    expect(result?.getMonth()).toBe(month);
    expect(result?.getDate()).toBe(date);
  });
});

// REQ-004 / REQ-010 tested via convert — no date signal → null
describe("extractPublishedAt — dated-none.html", () => {
  it("returns null when no structured date signals present", () => {
    const doc = fixtureDoc("dated-none.html");
    const result = extractPublishedAt(doc);
    expect(result).toBeNull();
  });
});
