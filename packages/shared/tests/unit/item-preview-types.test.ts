import { describe, expect, it } from "vitest";
import type {
  ItemPreview,
  LinkPreview,
  NoPreview,
  PoolItem,
  TweetPreview,
} from "@shared/types/index.js";
import { MARKDOWN_EXCERPT_MAX } from "@shared/constants/index.js";

// REQ-006, REQ-007, REQ-008, REQ-009, REQ-010
// Cross-phase type alignment: construct the exact shape Phase 3 will produce
// so type drift is caught here in Phase 1.

// --- Fixtures ----------------------------------------------------------

const tweetPreview: TweetPreview = {
  kind: "tweet",
  handle: "@karpathy",
  text: "Just dropped a new model. Check it out.",
  createdAt: "2026-05-26T08:00:00.000Z",
  photoUrls: ["https://pbs.twimg.com/media/photo.jpg"],
  url: "https://x.com/karpathy/status/123456",
  quoted: {
    handle: "@OpenAI",
    text: "Introducing GPT-5.",
  },
};

const linkPreview: LinkPreview = {
  kind: "link",
  title: "New Benchmark Sets AI Record",
  byline: "Jane Doe",
  description: "A new model achieves state of the art on MMLU.",
  imageUrl: "https://example.com/og.png",
  domain: "example.com",
  markdownExcerpt: "# Headline\n\nContent here.",
  url: "https://example.com/article",
};

const noPreview: NoPreview = { kind: "none" };

const poolItemNone: PoolItem = {
  id: 4,
  title: "Failed enrichment",
  url: "https://broken.example/article",
  sourceType: "web_search",
  author: null,
  publishedAt: null,
  engagement: { points: 0, commentCount: 0 },
  imageUrl: null,
  sourceIdentifier: "broken.example",
  preview: noPreview,
  recapSummary: null,
};

// --- Helper that exercises exhaustive switch ---------------------------

function describePreview(preview: ItemPreview): string {
  switch (preview.kind) {
    case "tweet":
      return `tweet by ${preview.handle}`;
    case "link":
      return `link: ${preview.url}`;
    case "none":
      return "no preview";
    default: {
      // exhaustiveness check: TypeScript should flag any unhandled kind
      const _exhaustive: never = preview;
      return _exhaustive;
    }
  }
}

// --- Tests -------------------------------------------------------------

describe("ItemPreview discriminated union (REQ-008)", () => {
  it("exhaustive switch compiles and handles all three kinds", () => {
    expect(describePreview(tweetPreview)).toBe("tweet by @karpathy");
    expect(describePreview(linkPreview)).toBe("link: https://example.com/article");
    expect(describePreview(noPreview)).toBe("no preview");
  });
});

describe("PoolItem with sourceIdentifier + preview (REQ-007, REQ-008)", () => {
  it("pool item with failed enrichment carries NoPreview (REQ-012, EDGE-003)", () => {
    expect(poolItemNone.preview.kind).toBe("none");
    expect(describePreview(poolItemNone.preview)).toBe("no preview");
  });
});

describe("MARKDOWN_EXCERPT_MAX constant (REQ-009)", () => {
  it("truncating markdownExcerpt to MARKDOWN_EXCERPT_MAX never exceeds the limit", () => {
    const long = "x".repeat(10000);
    const excerpt = long.slice(0, MARKDOWN_EXCERPT_MAX);
    expect(excerpt.length).toBe(4096);
    expect(excerpt.length).toBeLessThanOrEqual(MARKDOWN_EXCERPT_MAX);
  });
});
