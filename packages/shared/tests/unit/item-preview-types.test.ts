import { describe, expect, it } from "vitest";
import type {
  ItemPreview,
  LinkPreview,
  NoPreview,
  PoolItem,
  RankedItem,
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

const tweetPreviewNoQuoted: TweetPreview = {
  kind: "tweet",
  handle: "@sama",
  text: "Excited about what's coming.",
  createdAt: null,
  photoUrls: [],
  url: "https://x.com/sama/status/999",
  quoted: null,
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

const linkPreviewMinimal: LinkPreview = {
  kind: "link",
  title: null,
  byline: null,
  description: null,
  imageUrl: null,
  domain: null,
  markdownExcerpt: null,
  url: "https://example.com/bare",
};

const noPreview: NoPreview = { kind: "none" };

// A RankedItem with the new fields (REQ-006)
const rankedItem: RankedItem = {
  id: 1,
  rawItemId: 42,
  title: "New Benchmark Sets AI Record",
  url: "https://example.com/article",
  sourceType: "blog",
  author: "Jane Doe",
  publishedAt: "2026-05-26T00:00:00.000Z",
  engagement: { points: 150, commentCount: 30 },
  score: 0.87,
  rationale: "High novelty and actionability.",
  content: null,
  imageUrl: "https://example.com/og.png",
  recap: {
    title: "AI Record Broken By New Model",
    summary: "A model surpasses existing MMLU leaders.",
    bullets: ["New record", "Open weights"],
    bottomLine: "This changes the landscape.",
  },
  enrichedSource: { hostname: "example.com", url: "https://example.com" },
  sourceIdentifier: "example.com",
  preview: linkPreview,
};

// A PoolItem with the new fields (REQ-007, REQ-008)
const poolItemTweet: PoolItem = {
  id: 2,
  title: "Tweet about GPT-5",
  url: "https://x.com/karpathy/status/123456",
  sourceType: "twitter",
  author: "karpathy",
  publishedAt: "2026-05-26T08:00:00.000Z",
  engagement: { points: 0, commentCount: 0 },
  imageUrl: null,
  sourceIdentifier: "@karpathy",
  preview: tweetPreview,
  recapSummary: null,
};

const poolItemLink: PoolItem = {
  id: 3,
  title: "Article on example.com",
  url: "https://example.com/article",
  sourceType: "blog",
  author: null,
  publishedAt: null,
  engagement: { points: 5, commentCount: 1 },
  imageUrl: null,
  sourceIdentifier: "example.com",
  preview: linkPreview,
  recapSummary: null,
};

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
  it("TweetPreview has kind='tweet' and required fields", () => {
    expect(tweetPreview.kind).toBe("tweet");
    expect(tweetPreview.handle).toBe("@karpathy");
    expect(tweetPreview.photoUrls).toHaveLength(1);
    expect(tweetPreview.quoted?.handle).toBe("@OpenAI");
  });

  it("TweetPreview allows null createdAt and null quoted", () => {
    expect(tweetPreviewNoQuoted.createdAt).toBeNull();
    expect(tweetPreviewNoQuoted.quoted).toBeNull();
    expect(tweetPreviewNoQuoted.photoUrls).toHaveLength(0);
  });

  it("LinkPreview has kind='link' and required fields", () => {
    expect(linkPreview.kind).toBe("link");
    expect(linkPreview.domain).toBe("example.com");
    expect(linkPreview.markdownExcerpt).toBe("# Headline\n\nContent here.");
  });

  it("LinkPreview allows all nullable fields to be null", () => {
    expect(linkPreviewMinimal.title).toBeNull();
    expect(linkPreviewMinimal.byline).toBeNull();
    expect(linkPreviewMinimal.description).toBeNull();
    expect(linkPreviewMinimal.imageUrl).toBeNull();
    expect(linkPreviewMinimal.domain).toBeNull();
    expect(linkPreviewMinimal.markdownExcerpt).toBeNull();
  });

  it("NoPreview has kind='none'", () => {
    expect(noPreview.kind).toBe("none");
  });

  it("exhaustive switch compiles and handles all three kinds", () => {
    expect(describePreview(tweetPreview)).toBe("tweet by @karpathy");
    expect(describePreview(linkPreview)).toBe("link: https://example.com/article");
    expect(describePreview(noPreview)).toBe("no preview");
  });
});

describe("RankedItem with sourceIdentifier + preview (REQ-006)", () => {
  it("constructs a full RankedItem fixture with new fields", () => {
    expect(rankedItem.sourceIdentifier).toBe("example.com");
    expect(rankedItem.preview).toEqual(linkPreview);
  });

  it("preview on RankedItem is an ItemPreview", () => {
    expect(describePreview(rankedItem.preview)).toBe("link: https://example.com/article");
  });
});

describe("PoolItem with sourceIdentifier + preview (REQ-007, REQ-008)", () => {
  it("pool tweet item carries sourceIdentifier and TweetPreview", () => {
    expect(poolItemTweet.sourceIdentifier).toBe("@karpathy");
    expect(poolItemTweet.preview.kind).toBe("tweet");
  });

  it("pool link item carries sourceIdentifier and LinkPreview", () => {
    expect(poolItemLink.sourceIdentifier).toBe("example.com");
    expect(poolItemLink.preview.kind).toBe("link");
  });

  it("pool item with failed enrichment carries NoPreview (REQ-012, EDGE-003)", () => {
    expect(poolItemNone.preview.kind).toBe("none");
    expect(describePreview(poolItemNone.preview)).toBe("no preview");
  });
});

describe("MARKDOWN_EXCERPT_MAX constant (REQ-009)", () => {
  it("equals 4096", () => {
    expect(MARKDOWN_EXCERPT_MAX).toBe(4096);
  });

  it("truncating markdownExcerpt to MARKDOWN_EXCERPT_MAX never exceeds the limit", () => {
    const long = "x".repeat(10000);
    const excerpt = long.slice(0, MARKDOWN_EXCERPT_MAX);
    expect(excerpt.length).toBe(4096);
    expect(excerpt.length).toBeLessThanOrEqual(MARKDOWN_EXCERPT_MAX);
  });
});
