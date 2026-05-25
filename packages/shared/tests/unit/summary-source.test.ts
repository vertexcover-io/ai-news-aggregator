import { describe, it, expect } from "vitest";
import {
  pickSummarySource,
  deriveHostname,
  getPlatformLabel,
  PLATFORM_LABEL,
} from "@shared/services/summary-source.js";
import type { EnrichedLinkContent } from "@shared/types/index.js";
import type { SourceType } from "@shared/db/schema.js";

// ---------------------------------------------------------------------------
// pickSummarySource
// ---------------------------------------------------------------------------

describe("pickSummarySource", () => {
  it("enriched wins when status ok, markdown non-empty, valid URL, content also present", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://theverge.com/article",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "ok",
      markdown: "# Verge article",
    };
    const result = pickSummarySource("tweet text", enrichedLink);
    expect(result.kind).toBe("enriched");
    if (result.kind === "enriched") {
      expect(result.hostname).toBe("theverge.com");
      expect(result.url).toBe("https://theverge.com/article");
      expect(result.markdown).toBe("# Verge article");
    }
  });

  it("enriched wins when status ok, markdown non-empty, valid URL, content empty", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://arxiv.org/abs/2401.0001",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "ok",
      markdown: "Abstract text",
    };
    const result = pickSummarySource("", enrichedLink);
    expect(result.kind).toBe("enriched");
    if (result.kind === "enriched") {
      expect(result.hostname).toBe("arxiv.org");
    }
  });

  it("falls back to native when enriched ok but markdown is empty string", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://theverge.com/article",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "ok",
      markdown: "",
    };
    const result = pickSummarySource("native content here", enrichedLink);
    expect(result.kind).toBe("native");
    if (result.kind === "native") {
      expect(result.content).toBe("native content here");
    }
  });

  it("falls back to native when enriched status is failed", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://theverge.com/article",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "failed",
      failureReason: "timeout",
    };
    const result = pickSummarySource("selftext content", enrichedLink);
    expect(result.kind).toBe("native");
    if (result.kind === "native") {
      expect(result.content).toBe("selftext content");
    }
  });

  it("falls back to native when enriched status is skipped", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://news.ycombinator.com/item?id=1",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "skipped",
      skipReason: "no-url",
    };
    const result = pickSummarySource("HN self-post text", enrichedLink);
    expect(result.kind).toBe("native");
  });

  it("returns native when no enrichedLink and content is non-empty", () => {
    const result = pickSummarySource("tweet body text", null);
    expect(result.kind).toBe("native");
    if (result.kind === "native") {
      expect(result.content).toBe("tweet body text");
    }
  });

  it("returns none when no enrichedLink and content is null", () => {
    const result = pickSummarySource(null, undefined);
    expect(result.kind).toBe("none");
  });

  it("falls back to native (or none) when enriched ok but URL is malformed (REQ-012)", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "::::not-a-url",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "ok",
      markdown: "x",
    };
    const resultWithContent = pickSummarySource("fallback content", enrichedLink);
    expect(resultWithContent.kind).not.toBe("enriched");

    const resultNoContent = pickSummarySource(null, enrichedLink);
    expect(resultNoContent.kind).not.toBe("enriched");
  });

  it("returns none when enriched ok but markdown empty and content is null", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://theverge.com/article",
      fetchedAt: "2026-05-25T00:00:00Z",
      status: "ok",
      markdown: "",
    };
    const result = pickSummarySource(null, enrichedLink);
    expect(result.kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// deriveHostname
// ---------------------------------------------------------------------------

describe("deriveHostname", () => {
  it("strips www. prefix and returns lowercased hostname", () => {
    expect(deriveHostname("https://www.theverge.com/2026/1/article")).toBe("theverge.com");
  });

  it("returns hostname as-is when no www. prefix", () => {
    expect(deriveHostname("https://arxiv.org/abs/2401.0001")).toBe("arxiv.org");
  });

  it("lowercases hostname and strips www. from uppercase URL", () => {
    expect(deriveHostname("https://WWW.EXAMPLE.COM")).toBe("example.com");
  });

  it("returns null for a malformed URL", () => {
    expect(deriveHostname("not a url")).toBeNull();
  });

  it("strips port from hostname (URL.hostname already does this)", () => {
    expect(deriveHostname("https://example.com:8080/foo")).toBe("example.com");
  });

  it("returns null for empty string", () => {
    expect(deriveHostname("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PLATFORM_LABEL + getPlatformLabel
// ---------------------------------------------------------------------------

describe("PLATFORM_LABEL", () => {
  it("has an entry for every SourceType and all values are non-empty strings", () => {
    const allSourceTypes: SourceType[] = [
      "hn",
      "reddit",
      "rss",
      "blog",
      "twitter",
      "github",
      "newsletter",
      "web_search",
    ];
    for (const sourceType of allSourceTypes) {
      const label = PLATFORM_LABEL[sourceType];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("preserves verbatim labels from spec REQ-018", () => {
    expect(PLATFORM_LABEL.hn).toBe("Hacker News");
    expect(PLATFORM_LABEL.reddit).toBe("Reddit");
    expect(PLATFORM_LABEL.rss).toBe("RSS");
    expect(PLATFORM_LABEL.blog).toBe("Blog");
    expect(PLATFORM_LABEL.twitter).toBe("X / Twitter");
    expect(PLATFORM_LABEL.github).toBe("GitHub");
    expect(PLATFORM_LABEL.newsletter).toBe("Newsletter");
    expect(PLATFORM_LABEL.web_search).toBe("Web Search");
  });
});

describe("getPlatformLabel", () => {
  it("delegates to PLATFORM_LABEL and returns the string", () => {
    expect(getPlatformLabel("hn")).toBe("Hacker News");
    expect(getPlatformLabel("github")).toBe("GitHub");
    expect(getPlatformLabel("web_search")).toBe("Web Search");
  });
});
