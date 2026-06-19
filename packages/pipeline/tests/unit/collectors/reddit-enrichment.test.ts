/**
 * collectReddit + link enrichment integration tests.
 *
 * Tests that when deps.enrichment is provided, enrichRawItems is called and
 * updates the stored items. Uses injected fake actor-runner (no network).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { ApifyRedditPost } from "@pipeline/lib/apify-reddit.js";
import {
  createEnrichmentCache,
  newCounters,
  type EnrichmentContext,
} from "@pipeline/services/link-enrichment/index.js";

const fetchAdaptiveMock = vi.hoisted(() => vi.fn());

vi.mock("@pipeline/services/web-fetch/fetch-adaptive.js", () => ({
  fetchAdaptive: fetchAdaptiveMock,
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: () => undefined;
    warn: () => undefined;
    error: () => undefined;
    debug: () => undefined;
  } => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

const { collectReddit } = await import("@pipeline/collectors/reddit.js");

function stubLogger(): Logger {
  const fn = vi.fn();
  return {
    info: fn,
    warn: fn,
    error: fn,
    debug: fn,
    trace: fn,
    fatal: fn,
    child: () => stubLogger(),
  } as unknown as Logger;
}

function makeEnrichmentCtx(): EnrichmentContext {
  return {
    logger: stubLogger(),
    cache: createEnrichmentCache(),
    counters: newCounters(),
    signal: undefined,
  };
}

type MockUpsert = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;
type TokenResult = { apiToken: string; source: "db" | "env" } | null;

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsert } {
  return {
    upsertItems: vi
      .fn<[items: RawItemInsert[]], Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function makeFakePost(overrides: Partial<ApifyRedditPost> = {}): ApifyRedditPost {
  return {
    parsedId: "post001",
    title: "New open-source LLM beats GPT-4 on benchmarks",
    url: "https://www.reddit.com/r/MachineLearning/comments/post001/new_opensource_llm/",
    link: "https://example.com/new-llm", // external link
    username: "ml_researcher",
    body: "",
    createdAt: "2026-05-14T12:00:00Z",
    upVotes: 5,
    numberOfComments: 2,
    parsedCommunityName: "MachineLearning",
    imageUrls: [],
    dataType: "post",
    ...overrides,
  };
}

describe("collectReddit + link enrichment (VS-1)", () => {
  beforeEach(() => {
    fetchAdaptiveMock.mockReset();
  });

  it("enriches external link posts and skips self-posts", async () => {
    const { ConvertResultOk } = await import("@pipeline/services/web-fetch/types.js").catch(
      () => ({ ConvertResultOk: undefined }),
    );
    void ConvertResultOk;

    fetchAdaptiveMock.mockResolvedValue({
      markdown: "# Article body",
      title: "External Article",
      byline: "Reporter",
      imageUrl: "https://example.com/img.png",
      textLength: 14,
    });

    const externalPost = makeFakePost({
      parsedId: "post001",
      link: "https://example.com/new-llm",
    });
    // Self-post: url === link (same permalink)
    const selfUrl = "https://www.reddit.com/r/MachineLearning/comments/post002/discussion/";
    const selfPost = makeFakePost({
      parsedId: "post002",
      title: "Discussion",
      url: selfUrl,
      link: undefined, // no external link → url falls back to permalink
    });

    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([externalPost, selfPost]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });

    const repo = createMockRepo();
    const config: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      commentsPerItem: 0,
    };
    const enrichment = makeEnrichmentCtx();

    const result: CollectorResult = await collectReddit(
      { rawItemsRepo: repo, runListing, resolveToken, enrichment },
      config,
    );

    expect(result.itemsFetched).toBe(2);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const stored = repo.upsertItems.mock.calls[0][0];

    const linkPost = stored.find((i) => i.externalId === "post001");
    const storedSelfPost = stored.find((i) => i.externalId === "post002");

    expect(linkPost?.metadata?.enrichedLink?.status).toBe("ok");
    expect(linkPost?.metadata?.enrichedLink?.title).toBe("External Article");

    expect(storedSelfPost?.metadata?.enrichedLink?.status).toBe("skipped");
    expect(storedSelfPost?.metadata?.enrichedLink?.skipReason).toBe("no-url");

    expect(enrichment.counters.ok).toBe(1);
    expect(enrichment.counters.skipped).toBe(1);
    expect(enrichment.counters.skippedReasons.get("no-url")).toBe(1);
    expect(fetchAdaptiveMock).toHaveBeenCalledTimes(1);
  });

  it("does not enrich when deps.enrichment is absent", async () => {
    const externalPost = makeFakePost({ parsedId: "post001" });
    const runListing = vi.fn<[string, unknown, ({ signal?: AbortSignal } | undefined)?], Promise<ApifyRedditPost[]>>()
      .mockResolvedValue([externalPost]);
    const resolveToken = vi.fn<[], Promise<TokenResult>>()
      .mockResolvedValue({ apiToken: "tok", source: "env" });

    const repo = createMockRepo();
    const config: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      commentsPerItem: 0,
    };

    await collectReddit(
      { rawItemsRepo: repo, runListing, resolveToken },
      config,
    );

    const stored = repo.upsertItems.mock.calls[0][0];
    expect(stored.every((i) => i.metadata?.enrichedLink === undefined)).toBe(true);
    expect(fetchAdaptiveMock).not.toHaveBeenCalled();
  });
});
