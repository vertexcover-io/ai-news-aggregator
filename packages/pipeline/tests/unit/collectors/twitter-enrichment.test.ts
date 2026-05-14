import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";
import {
  createEnrichmentCache,
  newCounters,
  type EnrichmentContext,
} from "@pipeline/services/link-enrichment/index.js";
import type {
  NormalizedTweet,
  TwitterClient,
  TwitterClientFetchOptions,
  TwitterClientFetchResult,
} from "@pipeline/collectors/twitter/types.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";

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

const { collectTwitter } = await import("@pipeline/collectors/twitter/index.js");

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

interface MockRepo extends RawItemsRepo {
  upsertItems: MockUpsert;
}

function createMockRepo(): MockRepo {
  return {
    upsertItems: vi
      .fn<[items: RawItemInsert[]], Promise<void>>()
      .mockResolvedValue(undefined),
    findExistingExternalIds: vi.fn().mockResolvedValue(new Set<string>()),
    findBySourceAndExternalId: vi.fn().mockResolvedValue(null),
    updateRecapData: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTweet(overrides: Partial<NormalizedTweet> = {}): NormalizedTweet {
  const id = overrides.id ?? "1";
  const authorHandle = overrides.authorHandle ?? "alice";
  return {
    id,
    authorHandle,
    fullText: "hello",
    createdAt: "2026-05-01T00:00:00.000Z",
    eventCreatedAt: "2026-05-01T00:00:00.000Z",
    url: `https://x.com/${authorHandle}/status/${id}`,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    photoUrls: [],
    isRetweet: false,
    isQuote: false,
    ...overrides,
  };
}

interface ClientStub extends TwitterClient {
  fetchListTweets: ReturnType<
    typeof vi.fn<
      [listId: string, opts?: TwitterClientFetchOptions],
      Promise<TwitterClientFetchResult>
    >
  >;
  fetchUserTimeline: ReturnType<
    typeof vi.fn<
      [userId: string, opts?: TwitterClientFetchOptions],
      Promise<TwitterClientFetchResult>
    >
  >;
}

function createClientStub(tweets: NormalizedTweet[]): ClientStub {
  const stub: ClientStub = {
    fetchListTweets: vi.fn().mockResolvedValue({ tweets, nextCursor: null }),
    fetchUserTimeline: vi.fn().mockResolvedValue({ tweets: [], nextCursor: null }),
  };
  return stub;
}

const ORIGINAL_KEY = process.env.RETTIWT_API_KEY;

describe("collectTwitter + link enrichment (VS-3)", () => {
  beforeEach(() => {
    fetchAdaptiveMock.mockReset();
    process.env.RETTIWT_API_KEY = "fake-key";
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.RETTIWT_API_KEY;
    } else {
      process.env.RETTIWT_API_KEY = ORIGINAL_KEY;
    }
  });

  it("routes external links through url, skips same-platform tweets, and copies enrichment imageUrl when missing", async () => {
    const okResult: ConvertResult = {
      markdown: "# Paper",
      title: "Arxiv Paper",
      byline: "Authors",
      imageUrl: "https://cdn.example.com/preview.png",
      textLength: 6,
    };
    fetchAdaptiveMock.mockResolvedValue(okResult);

    const withExternal = makeTweet({
      id: "ext-1",
      externalUrl: "https://arxiv.org/abs/2401.00001",
    });
    const platformOnly = makeTweet({ id: "plat-1" });

    const client = createClientStub([withExternal, platformOnly]);
    const repo = createMockRepo();
    const enrichment = makeEnrichmentCtx();
    const config: TwitterCollectConfig = { listIds: ["L1"], users: [] };

    await collectTwitter(
      {
        client,
        rawItemsRepo: repo,
        enrichment,
        sleep: () => Promise.resolve(),
      },
      config,
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const stored = repo.upsertItems.mock.calls[0][0];
    const ext = stored.find((i) => i.externalId === "ext-1");
    const plat = stored.find((i) => i.externalId === "plat-1");

    expect(ext?.url).toBe("https://arxiv.org/abs/2401.00001");
    expect(ext?.sourceUrl).toBe("https://x.com/alice/status/ext-1");
    expect(ext?.metadata?.enrichedLink?.status).toBe("ok");
    expect(ext?.imageUrl).toBe("https://cdn.example.com/preview.png");

    expect(plat?.url).toBe("https://x.com/alice/status/plat-1");
    expect(plat?.metadata?.enrichedLink?.status).toBe("skipped");
    expect(plat?.metadata?.enrichedLink?.skipReason).toBe("same-platform");

    expect(enrichment.counters.ok).toBe(1);
    expect(enrichment.counters.skipped).toBe(1);
    expect(fetchAdaptiveMock).toHaveBeenCalledTimes(1);
  });

  it("preserves photo imageUrl over enrichment imageUrl when both exist", async () => {
    fetchAdaptiveMock.mockResolvedValue({
      markdown: "x",
      title: "t",
      byline: null,
      imageUrl: "https://enriched.example.com/img.png",
      textLength: 1,
    } satisfies ConvertResult);

    const tweet = makeTweet({
      id: "p1",
      externalUrl: "https://example.com/article",
      photoUrls: ["https://pbs.twimg.com/photo.jpg"],
    });
    const client = createClientStub([tweet]);
    const repo = createMockRepo();
    const enrichment = makeEnrichmentCtx();
    const config: TwitterCollectConfig = { listIds: ["L1"], users: [] };

    await collectTwitter(
      {
        client,
        rawItemsRepo: repo,
        enrichment,
        sleep: () => Promise.resolve(),
      },
      config,
    );

    const stored = repo.upsertItems.mock.calls[0][0];
    expect(stored[0].imageUrl).toBe("https://pbs.twimg.com/photo.jpg");
  });

  it("does not enrich when deps.enrichment is absent", async () => {
    const tweet = makeTweet({
      id: "no-enrich",
      externalUrl: "https://example.com/x",
    });
    const client = createClientStub([tweet]);
    const repo = createMockRepo();
    const config: TwitterCollectConfig = { listIds: ["L1"], users: [] };

    await collectTwitter(
      { client, rawItemsRepo: repo, sleep: () => Promise.resolve() },
      config,
    );

    const stored = repo.upsertItems.mock.calls[0][0];
    expect(stored[0].metadata?.enrichedLink).toBeUndefined();
    expect(fetchAdaptiveMock).not.toHaveBeenCalled();
  });
});

