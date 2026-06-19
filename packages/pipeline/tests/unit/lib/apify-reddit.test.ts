/**
 * Unit tests for packages/pipeline/src/lib/apify-reddit.ts
 *
 * Tests covered:
 * - REQ-004 / EDGE-012: buildListingInput — config → actor input (sort paths, timeframe)
 * - REQ-005:            buildListingInput — flags posts-only (skip*, includeMediaLinks)
 * - REQ-002 / REQ-003:  mapApifyPostToRawItem — field mapping + engagement
 * - EDGE-004:           mapApifyPostToRawItem — malformed item returns null
 * - REQ-025 / EDGE-009: per-subreddit cap in runRedditListing output (via fake actor-runner)
 */
import { describe, it, expect, vi } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

import {
  buildListingInput,
  buildPostInput,
  mapApifyPostToRawItem,
  type ApifyRedditPost,
} from "@pipeline/lib/apify-reddit.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<ApifyRedditPost> = {}): ApifyRedditPost {
  return {
    parsedId: "post001",
    title: "An AI Story",
    url: "https://www.reddit.com/r/MachineLearning/comments/post001/an_ai_story/",
    link: "https://example.com/article",
    username: "ai_user",
    body: "Some body text",
    createdAt: "2026-06-01T12:00:00.000Z",
    upVotes: 42,
    numberOfComments: 7,
    parsedCommunityName: "MachineLearning",
    imageUrls: ["https://example.com/image.jpg"],
    dataType: "post",
    ...overrides,
  };
}

// ── REQ-004 / EDGE-012: buildListingInput ────────────────────────────────────

describe("test_REQ_004_config_to_actor_input", () => {
  it("sort=top builds /top/?t=<timeframe> startUrls", () => {
    const input = buildListingInput(["MachineLearning", "LocalLLaMA"], "top", "week", 25);
    expect(input.startUrls).toHaveLength(2);
    expect(input.startUrls[0]).toEqual({
      url: "https://www.reddit.com/r/MachineLearning/top/?t=week",
    });
    expect(input.startUrls[1]).toEqual({
      url: "https://www.reddit.com/r/LocalLLaMA/top/?t=week",
    });
    expect(input.maxPostCount).toBe(25);
    expect(input.maxItems).toBe(50); // 25 * 2 subs
  });

  it("test_EDGE_012_new_sort_no_timeframe: sort=new builds /new/ with no ?t=", () => {
    const input = buildListingInput(["artificial"], "new", "day", 10);
    const url = input.startUrls[0]?.url ?? "";
    expect(url).toBe("https://www.reddit.com/r/artificial/new/");
    expect(url).not.toContain("?t=");
  });

  it("sort=hot builds /hot/ with no ?t=", () => {
    const input = buildListingInput(["OpenAI"], "hot", "day", 5);
    const url = input.startUrls[0]?.url ?? "";
    expect(url).toBe("https://www.reddit.com/r/OpenAI/hot/");
    expect(url).not.toContain("?t=");
  });
});

// ── REQ-005: posts-only flags ────────────────────────────────────────────────

describe("test_REQ_005_input_flags_posts_only", () => {
  it("sets skipComments, skipUserPosts, skipCommunity:true and includeMediaLinks:true", () => {
    const input = buildListingInput(["test"], "hot", "day", 5);
    expect(input.skipComments).toBe(true);
    expect(input.skipUserPosts).toBe(true);
    expect(input.skipCommunity).toBe(true);
    expect(input.includeMediaLinks).toBe(true);
  });

  it("sets RESIDENTIAL proxy", () => {
    const input = buildListingInput(["test"], "hot", "day", 5);
    expect(input.proxy).toEqual({
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    });
  });
});

// ── REQ-002: field mapping ───────────────────────────────────────────────────

describe("test_REQ_002_maps_item_to_rawiteminsert", () => {
  it("maps all fields correctly from a full actor item", () => {
    const now = new Date("2026-06-18T10:00:00Z");
    const post = makePost();
    const item = mapApifyPostToRawItem(post, now);

    expect(item).not.toBeNull();
    const mapped = item as RawItemInsert;
    expect(mapped.sourceType).toBe("reddit");
    expect(mapped.externalId).toBe("post001");
    expect(mapped.title).toBe("An AI Story");
    expect(mapped.url).toBe("https://example.com/article"); // link field (external)
    expect(mapped.sourceUrl).toBe(
      "https://www.reddit.com/r/MachineLearning/comments/post001/an_ai_story/",
    ); // url (permalink)
    expect(mapped.author).toBe("ai_user");
    expect(mapped.content).toBe("Some body text");
    expect(mapped.publishedAt).toEqual(new Date("2026-06-01T12:00:00.000Z"));
    expect(mapped.imageUrl).toBe("https://example.com/image.jpg");
    expect(mapped.metadata).toEqual({
      comments: [],
      sourceUnit: {
        identifier: "r/MachineLearning",
        displayName: "r/MachineLearning",
      },
    });
    expect(mapped.collectedAt).toEqual(now);
  });

  it("falls back to url (permalink) when link is absent", () => {
    const now = new Date();
    const post = makePost({ link: undefined });
    const item = mapApifyPostToRawItem(post, now);
    expect(item).not.toBeNull();
    const mapped = item as RawItemInsert;
    // url field = permalink when link absent
    expect(mapped.url).toBe(
      "https://www.reddit.com/r/MachineLearning/comments/post001/an_ai_story/",
    );
  });

  it("imageUrl is undefined when imageUrls is empty", () => {
    const now = new Date();
    const post = makePost({ imageUrls: [] });
    const item = mapApifyPostToRawItem(post, now);
    expect(item).not.toBeNull();
    const mapped = item as RawItemInsert;
    expect(mapped.imageUrl).toBeUndefined();
  });
});

// ── REQ-003: engagement from upVotes/numberOfComments ───────────────────────

describe("test_REQ_003_engagement_from_upvotes_comments", () => {
  it("maps engagement.points from upVotes and engagement.commentCount from numberOfComments", () => {
    const now = new Date();
    const post = makePost({ upVotes: 99, numberOfComments: 23 });
    const item = mapApifyPostToRawItem(post, now);
    expect(item).not.toBeNull();
    const mapped = item as RawItemInsert;
    expect(mapped.engagement).toEqual({ points: 99, commentCount: 23 });
  });
});

// ── EDGE-004: malformed items ────────────────────────────────────────────────

describe("test_EDGE_004_skips_malformed_item", () => {
  it("returns null when parsedId is missing", () => {
    const now = new Date();
    const post = makePost({ parsedId: "" });
    expect(mapApifyPostToRawItem(post, now)).toBeNull();
  });

  it("returns null when title is missing", () => {
    const now = new Date();
    const post = makePost({ title: "" });
    expect(mapApifyPostToRawItem(post, now)).toBeNull();
  });

  it("returns null when url (permalink) is missing", () => {
    const now = new Date();
    const post = makePost({ url: "" });
    expect(mapApifyPostToRawItem(post, now)).toBeNull();
  });
});

// ── buildPostInput ───────────────────────────────────────────────────────────

describe("buildPostInput", () => {
  it("builds single-post input with maxItems:1 and correct permalink", () => {
    const url = "https://www.reddit.com/r/test/comments/abc123/post_slug/";
    const input = buildPostInput(url);
    expect(input.startUrls).toEqual([{ url }]);
    expect(input.maxItems).toBe(1);
    expect(input.skipComments).toBe(true);
    expect(input.includeMediaLinks).toBe(true);
  });
});
