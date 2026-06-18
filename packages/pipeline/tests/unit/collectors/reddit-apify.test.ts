/**
 * Unit tests for the rewritten Apify-based Reddit collector.
 *
 * All network calls are replaced by injected fake actor-runners and resolveToken.
 *
 * Tests covered (one-to-one with verification matrix):
 * REQ-001  uses_apify_runner_not_rss
 * REQ-006  unit_results_grouped_by_subreddit
 * REQ-007  dedupes_by_external_id
 * REQ-008  sincedays_filters_old_posts
 * REQ-009  persists_via_upsertitems
 * REQ-010  fetch_single_post
 * REQ-011  parse_reddit_post_url_pure
 * REQ-020  no_token_empty_result_no_throw
 * REQ-021  no_token_single_post_throws
 * REQ-022  actor_error_propagates
 * REQ-023  no_rss_jsdom_remaining (static source regression guard)
 * REQ-024  token_never_serialized
 * REQ-025  caps_items_per_subreddit
 * EDGE-001 unconfigured_batch_empty (upsert NOT called)
 * EDGE-002 actor_timeout_propagates
 * EDGE-003 empty_subreddit_unit_completed
 * EDGE-005 sincedays_zero_drop_warns
 * EDGE-006 cross_subreddit_dedupe
 * EDGE-007 single_post_not_found_throws
 * EDGE-009 overdelivery_capped
 * EDGE-010 single_post_unconfigured_throws
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { ApifyRedditPost } from "@pipeline/lib/apify-reddit.js";

// ── Logger mock ──────────────────────────────────────────────────────────────

const warnSpy = vi.fn<[obj: unknown, msg?: string], undefined>();
const logSpy = vi.fn<[obj: unknown, msg?: string], undefined>();

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: () => ({
    info: (obj: unknown, msg?: string): undefined => {
      logSpy(obj, msg);
      return undefined;
    },
    warn: (obj: unknown, msg?: string): undefined => {
      warnSpy(obj, msg);
      return undefined;
    },
    error: () => undefined,
    debug: () => undefined,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<ApifyRedditPost> = {}): ApifyRedditPost {
  return {
    parsedId: "post001",
    title: "Test Post",
    url: "https://www.reddit.com/r/MachineLearning/comments/post001/test_post/",
    link: "https://example.com/article",
    username: "user1",
    body: "body text",
    createdAt: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
    upVotes: 10,
    numberOfComments: 3,
    parsedCommunityName: "MachineLearning",
    imageUrls: [],
    dataType: "post",
    ...overrides,
  };
}

function makeRepo(): RawItemsRepo & { upsertItems: ReturnType<typeof vi.fn> } {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

type TokenResult = { apiToken: string; source: "db" | "env" } | null;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("collectReddit (Apify)", () => {
  beforeEach(() => {
    warnSpy.mockClear();
    logSpy.mockClear();
  });

  // ── REQ-001: uses apify runner not RSS ─────────────────────────────────────

  it("test_REQ_001_uses_apify_runner_not_rss", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([makePost()]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"] },
    );

    expect(runListing).toHaveBeenCalledOnce();
    // Verify the runner was called with a token and an input containing startUrls
    const [calledToken, calledInput] = runListing.mock.calls[0] as [string, { startUrls: unknown[] }];
    expect(calledToken).toBe("tok");
    expect(calledInput.startUrls).toBeDefined();
  });

  // ── REQ-006: unit results grouped by subreddit ─────────────────────────────

  it("test_REQ_006_unit_results_grouped_by_subreddit", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([
        makePost({ parsedCommunityName: "MachineLearning", parsedId: "a1" }),
        makePost({ parsedCommunityName: "MachineLearning", parsedId: "a2" }),
        makePost({ parsedCommunityName: "LocalLLaMA", parsedId: "b1" }),
      ]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning", "LocalLLaMA"] },
    );

    expect(result.unitResults).toHaveLength(2);
    const ml = result.unitResults?.find((u) => u.identifier === "r/MachineLearning");
    const ll = result.unitResults?.find((u) => u.identifier === "r/LocalLLaMA");
    expect(ml).toMatchObject({ status: "completed", itemsFetched: 2 });
    expect(ll).toMatchObject({ status: "completed", itemsFetched: 1 });
  });

  // ── EDGE-003: empty subreddit still has a completed unit ───────────────────

  it("test_EDGE_003_empty_subreddit_unit_completed", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]); // no posts for any sub
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning", "LocalLLaMA"] },
    );

    expect(result.unitResults).toHaveLength(2);
    for (const u of result.unitResults ?? []) {
      expect(u).toMatchObject({ status: "completed", itemsFetched: 0 });
    }
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });

  // ── REQ-007 / EDGE-006: dedupe by externalId ──────────────────────────────

  it("test_REQ_007_dedupes_by_external_id", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([
        makePost({ parsedId: "dup001", parsedCommunityName: "MachineLearning" }),
        makePost({ parsedId: "dup001", parsedCommunityName: "MachineLearning" }),
        makePost({ parsedId: "dup001", parsedCommunityName: "LocalLLaMA" }),
      ]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning", "LocalLLaMA"] },
    );

    expect(rawItemsRepo.upsertItems).toHaveBeenCalledOnce();
    const items = rawItemsRepo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    expect(items.filter((i) => i.externalId === "dup001")).toHaveLength(1);
  });

  it("test_EDGE_006_cross_subreddit_dedupe", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    // Same parsedId returned from two different subreddit names
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([
        makePost({ parsedId: "x123", parsedCommunityName: "OpenAI" }),
        makePost({ parsedId: "x123", parsedCommunityName: "artificial" }),
      ]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["OpenAI", "artificial"] },
    );

    const items = rawItemsRepo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    expect(items.filter((i) => i.externalId === "x123")).toHaveLength(1);
  });

  // ── REQ-008 / EDGE-005: sinceDays filter ──────────────────────────────────

  it("test_REQ_008_sincedays_filters_old_posts", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const oldPost = makePost({
      parsedId: "old001",
      createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), // 10 days ago
    });
    const freshPost = makePost({
      parsedId: "fresh001",
      createdAt: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
    });
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([oldPost, freshPost]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"], sinceDays: 7 },
    );

    expect(result.itemsFetched).toBe(1);
    const items = rawItemsRepo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    expect(items[0]?.externalId).toBe("fresh001");
  });

  it("test_EDGE_005_sincedays_zero_drop_warns", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const freshPost = makePost({ parsedId: "fresh001" });
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([freshPost]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"], sinceDays: 7 },
    );

    // sinceDays=7 and freshPost is 1 day ago → 0 dropped → warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sinceDays: 7 }),
      expect.stringContaining("truncated"),
    );
  });

  // ── REQ-009: persists via upsertItems ─────────────────────────────────────

  it("test_REQ_009_persists_via_upsertitems", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const posts = [
      makePost({ parsedId: "p1" }),
      makePost({ parsedId: "p2" }),
    ];
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue(posts);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"] },
    );

    expect(rawItemsRepo.upsertItems).toHaveBeenCalledOnce();
    const items = rawItemsRepo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    expect(items).toHaveLength(2);
    expect(result.itemsStored).toBe(2);
  });

  // ── REQ-020 / EDGE-001: no token → empty result, no throw, no upsert ──────

  it("test_REQ_020_no_token_empty_result_no_throw", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue(null);
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"] },
    );

    expect(result).toBeDefined();
    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
  });

  it("test_EDGE_001_unconfigured_batch_empty", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue(null);
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"] },
    );

    // Critically: upsert must NOT have been called
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
    expect(runListing).not.toHaveBeenCalled();
  });

  // ── REQ-022 / EDGE-002: actor error propagates ────────────────────────────

  it("test_REQ_022_actor_error_propagates", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const actorError = new Error("Actor run failed");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockRejectedValue(actorError);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await expect(
      collectReddit(
        { rawItemsRepo, runListing, resolveToken },
        { subreddits: ["MachineLearning"] },
      ),
    ).rejects.toThrow("Actor run failed");
  });

  it("test_EDGE_002_actor_timeout_propagates", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const timeoutError = new Error("Actor timed out after 180s");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockRejectedValue(timeoutError);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await expect(
      collectReddit(
        { rawItemsRepo, runListing, resolveToken },
        { subreddits: ["MachineLearning"] },
      ),
    ).rejects.toThrow("Actor timed out");
  });

  // ── REQ-025 / EDGE-009: cap per subreddit ─────────────────────────────────

  it("test_REQ_025_caps_items_per_subreddit", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    // Actor over-delivers: 5 posts for MachineLearning, limit=2
    const posts = Array.from({ length: 5 }, (_, i) =>
      makePost({ parsedId: `ml${i}`, parsedCommunityName: "MachineLearning" }),
    );
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue(posts);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"], limit: 2 },
    );

    const items = rawItemsRepo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    const mlItems = items.filter((i) =>
      i.metadata?.sourceUnit?.identifier === "r/MachineLearning",
    );
    expect(mlItems.length).toBeLessThanOrEqual(2);
  });

  it("test_EDGE_009_overdelivery_capped", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const posts = Array.from({ length: 10 }, (_, i) =>
      makePost({ parsedId: `ov${i}`, parsedCommunityName: "OpenAI" }),
    );
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue(posts);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["OpenAI"], limit: 3 },
    );

    const items = rawItemsRepo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    expect(items.length).toBeLessThanOrEqual(3);
  });

  // ── REQ-024: token never logged ────────────────────────────────────────────

  it("test_REQ_024_token_never_serialized", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([makePost()]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "super_secret_token_xyz", source: "db" });
    const rawItemsRepo = makeRepo();

    await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"] },
    );

    // Ensure the token was never passed to any logger call
    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("super_secret_token_xyz");
    }
    for (const call of warnSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("super_secret_token_xyz");
    }
  });
});

// ── fetchRedditPost tests ────────────────────────────────────────────────────

describe("fetchRedditPost (Apify)", () => {
  beforeEach(() => {
    warnSpy.mockClear();
    logSpy.mockClear();
  });

  // ── REQ-011: parseRedditPostUrl is pure (no network) ──────────────────────

  it("test_REQ_011_parse_reddit_post_url_pure", async () => {
    const { parseRedditPostUrl } = await import("@pipeline/collectors/reddit.js");
    // Pure function — no deps, no network
    expect(parseRedditPostUrl("https://www.reddit.com/r/test/comments/abc123/slug/")).toEqual({
      subreddit: "test",
      postId: "abc123",
    });
    expect(parseRedditPostUrl("https://example.com/not-reddit")).toBeNull();
    // No network call was made (no runPost was invoked)
  });

  // ── REQ-010: fetch single post via runner ─────────────────────────────────

  it("test_REQ_010_fetch_single_post", async () => {
    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    const post = makePost({
      parsedId: "abc123",
      parsedCommunityName: "test",
      url: "https://www.reddit.com/r/test/comments/abc123/slug/",
    });
    const runPost = vi.fn<[string, string, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([post]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });

    const result = await fetchRedditPost(
      "https://www.reddit.com/r/test/comments/abc123/slug/",
      { resolveToken, runPost },
    );

    expect(result.externalId).toBe("abc123");
    expect(result.sourceType).toBe("reddit");
    expect(runPost).toHaveBeenCalledOnce();
  });

  // ── REQ-021 / EDGE-010: no token → throws ────────────────────────────────

  it("test_REQ_021_no_token_single_post_throws", async () => {
    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    const resolveToken = vi.fn<[], Promise<TokenResult>>().mockResolvedValue(null);
    const runPost = vi.fn<[string, string, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]);

    await expect(
      fetchRedditPost(
        "https://www.reddit.com/r/test/comments/abc123/slug/",
        { resolveToken, runPost },
      ),
    ).rejects.toThrow("Apify integration not configured");
  });

  it("test_EDGE_010_single_post_unconfigured_throws", async () => {
    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    const runPost = vi.fn<[string, string, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]);
    // resolveToken not provided → no token
    await expect(
      fetchRedditPost(
        "https://www.reddit.com/r/test/comments/abc123/slug/",
        { runPost },
      ),
    ).rejects.toThrow("Apify integration not configured");
  });

  // ── EDGE-007: post not found → throws ────────────────────────────────────

  it("test_EDGE_007_single_post_not_found_throws", async () => {
    const { fetchRedditPost } = await import("@pipeline/collectors/reddit.js");
    const runPost = vi.fn<[string, string, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]); // empty — actor found nothing
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });

    await expect(
      fetchRedditPost(
        "https://www.reddit.com/r/test/comments/abc123/slug/",
        { resolveToken, runPost },
      ),
    ).rejects.toThrow("post not found");
  });
});

// ── REQ-023: static regression guard — no RSS/jsdom ──────────────────────────

describe("test_REQ_023_no_rss_jsdom_remaining", () => {
  it("collectors/reddit.ts source contains no jsdom import or rss URL construction", () => {
    const sourcePath = resolve(
      __dirname,
      "../../../src/collectors/reddit.ts",
    );
    const source = readFileSync(sourcePath, "utf-8");
    // Check for import statements referencing jsdom
    expect(source).not.toMatch(/import.*from.*["']jsdom["']/);
    // Check for .rss URL construction (not comments)
    const lines = source.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    const rssInCode = lines.filter((l) => l.includes(".rss"));
    expect(rssInCode).toHaveLength(0);
  });
});
