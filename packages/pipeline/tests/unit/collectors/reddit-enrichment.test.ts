import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";
import {
  createEnrichmentCache,
  newCounters,
  type EnrichmentContext,
} from "@pipeline/services/link-enrichment/index.js";
import redditListingFixture from "@pipeline-tests/unit/fixtures/reddit-listing.json";

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

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsert } {
  return {
    upsertItems: vi
      .fn<[items: RawItemInsert[]], Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function makeFetchFn(): typeof fetch {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(redditListingFixture),
    }),
  ) as unknown as typeof fetch;
}

describe("collectReddit + link enrichment (VS-1)", () => {
  beforeEach(() => {
    fetchAdaptiveMock.mockReset();
  });

  it("enriches external link posts and skips self-posts", async () => {
    const okResult: ConvertResult = {
      markdown: "# Article body",
      title: "External Article",
      byline: "Reporter",
      imageUrl: "https://example.com/img.png",
      textLength: 14,
    };
    fetchAdaptiveMock.mockResolvedValue(okResult);

    const repo = createMockRepo();
    const config: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      commentsPerItem: 0,
    };
    const enrichment = makeEnrichmentCtx();

    const result: CollectorResult = await collectReddit(
      { rawItemsRepo: repo, fetchFn: makeFetchFn(), enrichment },
      config,
    );

    expect(result.itemsFetched).toBe(2);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const stored = repo.upsertItems.mock.calls[0][0];

    const linkPost = stored.find((i) => i.externalId === "post001");
    const selfPost = stored.find((i) => i.externalId === "post002");

    expect(linkPost?.metadata?.enrichedLink?.status).toBe("ok");
    expect(linkPost?.metadata?.enrichedLink?.title).toBe("External Article");

    expect(selfPost?.metadata?.enrichedLink?.status).toBe("skipped");
    expect(selfPost?.metadata?.enrichedLink?.skipReason).toBe("no-url");

    expect(enrichment.counters.ok).toBe(1);
    expect(enrichment.counters.skipped).toBe(1);
    expect(enrichment.counters.skippedReasons.get("no-url")).toBe(1);
    expect(fetchAdaptiveMock).toHaveBeenCalledTimes(1);
  });

  it("does not enrich when deps.enrichment is absent", async () => {
    const repo = createMockRepo();
    const config: RedditCollectConfig = {
      subreddits: ["MachineLearning"],
      commentsPerItem: 0,
    };

    await collectReddit(
      { rawItemsRepo: repo, fetchFn: makeFetchFn() },
      config,
    );

    const stored = repo.upsertItems.mock.calls[0][0];
    expect(stored.every((i) => i.metadata?.enrichedLink === undefined)).toBe(true);
    expect(fetchAdaptiveMock).not.toHaveBeenCalled();
  });
});
