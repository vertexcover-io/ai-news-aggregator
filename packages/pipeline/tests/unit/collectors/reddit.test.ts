/**
 * Reddit collector batch behavior tests.
 *
 * All tests use injected fake actor-runners (no network). The old RSS/jsdom
 * tests were removed when the collector was rewritten to use Apify
 * (REQ-023 + the new apify-reddit.test.ts / reddit-apify.test.ts suites).
 *
 * This file is a thin regression guard for the collectReddit interface contract.
 * Full coverage lives in reddit-apify.test.ts (REQ-001 through REQ-025, all EDGEs).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { ApifyRedditPost } from "@pipeline/lib/apify-reddit.js";

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: (obj: unknown, msg?: string) => undefined;
    warn: (obj: unknown, msg?: string) => undefined;
    error: (obj: unknown, msg?: string) => undefined;
    debug: (obj: unknown, msg?: string) => undefined;
  } => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

function makePost(overrides: Partial<ApifyRedditPost> = {}): ApifyRedditPost {
  return {
    parsedId: "post001",
    title: "Test Post",
    url: "https://www.reddit.com/r/MachineLearning/comments/post001/test_post/",
    link: "https://example.com/article",
    username: "user1",
    body: "body text",
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
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

describe("collectReddit (Apify interface contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns itemsFetched, itemsStored, unitResults on a normal run", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([makePost({ parsedId: "p1" }), makePost({ parsedId: "p2" })]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"], limit: 25 },
    );

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsStored).toBe(2);
    expect(result.commentsFetched).toBe(0);
    expect(result.unitResults).toHaveLength(1);
    expect(rawItemsRepo.upsertItems).toHaveBeenCalledOnce();
  });

  it("returns empty result when no token is configured", async () => {
    const { collectReddit } = await import("@pipeline/collectors/reddit.js");
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>().mockResolvedValue(null);
    const rawItemsRepo = makeRepo();

    const result = await collectReddit(
      { rawItemsRepo, runListing, resolveToken },
      { subreddits: ["MachineLearning"] },
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(rawItemsRepo.upsertItems).not.toHaveBeenCalled();
  });
});
