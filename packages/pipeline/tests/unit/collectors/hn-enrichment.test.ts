import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";
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

const { collectHn } = await import("@pipeline/collectors/hn.js");

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

const STORIES_RESPONSE = {
  hits: [
    {
      objectID: "70000001",
      title: "Ask HN: How do you handle prompt injection?",
      url: null,
      author: "alice",
      points: 42,
      num_comments: 0,
      created_at: "2026-04-10T12:00:00Z",
      story_text: "I'm building an agent and wondering about defenses...",
    },
    {
      objectID: "70000002",
      title: "Sparse Transformers paper",
      url: "https://arxiv.org/abs/2310.12345",
      author: "bob",
      points: 110,
      num_comments: 0,
      created_at: "2026-04-10T14:30:00Z",
      story_text: null,
    },
  ],
  nbHits: 2,
};

function makeFetchFn(): typeof fetch {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(STORIES_RESPONSE),
    }),
  ) as unknown as typeof fetch;
}

describe("collectHn + link enrichment (VS-2)", () => {
  beforeEach(() => {
    fetchAdaptiveMock.mockReset();
  });

  it("enriches arxiv submission, skips Ask HN, and copies enriched imageUrl onto the row", async () => {
    const okResult: ConvertResult = {
      markdown: "# Sparse Transformers",
      title: "Sparse Transformers: A Survey",
      byline: "Researcher",
      imageUrl: "https://arxiv.org/static/og.png",
      textLength: 28,
    };
    fetchAdaptiveMock.mockResolvedValue(okResult);

    const repo = createMockRepo();
    const config: HnCollectConfig = { feeds: ["newest"], keywords: ["AI"], commentsPerItem: 0 };
    const enrichment = makeEnrichmentCtx();

    const result: CollectorResult = await collectHn(
      { rawItemsRepo: repo, fetchFn: makeFetchFn(), enrichment },
      config,
    );

    expect(result.itemsFetched).toBe(2);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const stored = repo.upsertItems.mock.calls[0][0];

    const askHn = stored.find((i) => i.externalId === "70000001");
    const arxiv = stored.find((i) => i.externalId === "70000002");

    expect(askHn?.metadata?.enrichedLink?.status).toBe("skipped");
    expect(askHn?.metadata?.enrichedLink?.skipReason).toBe("no-url");

    expect(arxiv?.metadata?.enrichedLink?.status).toBe("ok");
    expect(arxiv?.metadata?.enrichedLink?.title).toBe("Sparse Transformers: A Survey");
    expect(arxiv?.metadata?.enrichedLink?.title?.length ?? 0).toBeGreaterThan(0);

    expect(arxiv?.imageUrl).toBe("https://arxiv.org/static/og.png");

    expect(enrichment.counters.ok).toBe(1);
    expect(enrichment.counters.skipped).toBe(1);
    expect(enrichment.counters.skippedReasons.get("no-url")).toBe(1);
    expect(fetchAdaptiveMock).toHaveBeenCalledTimes(1);
  });

  it("does not enrich when deps.enrichment is absent", async () => {
    const repo = createMockRepo();
    const config: HnCollectConfig = { feeds: ["newest"], keywords: ["AI"], commentsPerItem: 0 };

    await collectHn(
      { rawItemsRepo: repo, fetchFn: makeFetchFn() },
      config,
    );

    const stored = repo.upsertItems.mock.calls[0][0];
    expect(stored.every((i) => i.metadata?.enrichedLink === undefined)).toBe(true);
    expect(fetchAdaptiveMock).not.toHaveBeenCalled();
  });
});
