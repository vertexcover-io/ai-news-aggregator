/* eslint-disable @typescript-eslint/require-await */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { RunSubmitWebSearchConfig } from "@newsletter/shared/types";
import type {
  SearchInput,
  WebSearchProvider,
  WebSearchResult,
} from "@pipeline/collectors/web-search/providers/types.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

const enrichSpy = vi.fn<[RawItemInsert[], EnrichmentContext], Promise<RawItemInsert[]>>();
vi.mock("@pipeline/services/link-enrichment/index.js", () => ({
  enrichRawItems: (items: RawItemInsert[], ctx: EnrichmentContext) => enrichSpy(items, ctx),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

import { collectWebSearch } from "@pipeline/collectors/web-search/index.js";

type MockUpsertFn = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;
type MockSearchFn = ReturnType<typeof vi.fn<[input: SearchInput], Promise<WebSearchResult[]>>>;

interface MockRepo {
  upsertItems: MockUpsertFn;
}

interface MockProvider extends WebSearchProvider {
  search: MockSearchFn;
}

function createMockRepo(): MockRepo {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

function createMockProvider(impl: (input: SearchInput) => Promise<WebSearchResult[]> | WebSearchResult[]): MockProvider {
  const search = vi.fn<[input: SearchInput], Promise<WebSearchResult[]>>().mockImplementation(async (input) => {
    return impl(input);
  });
  return { name: "tavily", search };
}

function makeResult(overrides: Partial<WebSearchResult> & { url: string }): WebSearchResult {
  return {
    url: overrides.url,
    title: overrides.title ?? `Title for ${overrides.url}`,
    snippet: overrides.snippet ?? "snippet",
    publishedAt: "publishedAt" in overrides ? overrides.publishedAt ?? null : new Date("2026-05-15T00:00:00Z"),
    imageUrl: overrides.imageUrl,
    rawScore: overrides.rawScore,
    providerMetadata: overrides.providerMetadata,
  };
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("collectWebSearch", () => {
  beforeEach(() => {
    enrichSpy.mockReset();
    enrichSpy.mockImplementation(async (items) => items);
  });

  it("happy path: 2 queries × 3 results", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async (input) => [
      makeResult({ url: `https://a.com/${input.query}/1`, rawScore: 0.9 }),
      makeResult({ url: `https://a.com/${input.query}/2`, rawScore: 0.8 }),
      makeResult({ url: `https://a.com/${input.query}/3`, rawScore: 0.7 }),
    ]);

    const config: RunSubmitWebSearchConfig = {
      provider: "tavily",
      queries: [
        { query: "agentic AI", sinceDays: 7, maxItems: 3 },
        { query: "context engineering", sinceDays: 7, maxItems: 3 },
      ],
    };

    const result = await collectWebSearch({ rawItemsRepo: repo, provider }, config);

    expect(result.itemsFetched).toBe(6);
    expect(result.itemsStored).toBe(6);
    expect(result.commentsFetched).toBe(0);
    expect(result.unitResults).toHaveLength(2);
    expect(result.unitResults?.every((u) => u.errors.length === 0)).toBe(true);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    expect(repo.upsertItems.mock.calls[0]?.[0]).toHaveLength(6);
  });

  it("per-query failure isolation", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async (input) => {
      if (input.query === "fails") throw new Error("boom");
      return [
        makeResult({ url: "https://b.com/1" }),
        makeResult({ url: "https://b.com/2" }),
      ];
    });

    const config: RunSubmitWebSearchConfig = {
      provider: "tavily",
      queries: [
        { query: "fails", sinceDays: 7, maxItems: 5 },
        { query: "works", sinceDays: 7, maxItems: 5 },
      ],
    };

    const result = await collectWebSearch({ rawItemsRepo: repo, provider }, config);

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsStored).toBe(2);
    expect(result.unitResults).toHaveLength(2);

    const failed = result.unitResults?.find((u) => u.errors.length > 0);
    const ok = result.unitResults?.find((u) => u.errors.length === 0);
    expect(failed?.errors[0]).toContain("boom");
    expect(failed?.itemsFetched).toBe(0);
    expect(ok?.itemsFetched).toBe(2);
  });

  it("URL dedup across queries keeps higher rawScore", async () => {
    const repo = createMockRepo();
    const shared = "https://shared.com/article";
    const provider = createMockProvider(async (input) => {
      if (input.query === "q1") {
        return [
          makeResult({ url: shared, rawScore: 0.4, title: "low" }),
          makeResult({ url: "https://q1.com/x", rawScore: 0.5 }),
        ];
      }
      return [
        makeResult({ url: shared, rawScore: 0.9, title: "high" }),
        makeResult({ url: "https://q2.com/x", rawScore: 0.6 }),
      ];
    });

    const config: RunSubmitWebSearchConfig = {
      provider: "tavily",
      queries: [
        { query: "q1", sinceDays: 7, maxItems: 5 },
        { query: "q2", sinceDays: 7, maxItems: 5 },
      ],
    };

    const result = await collectWebSearch({ rawItemsRepo: repo, provider }, config);

    expect(result.itemsFetched).toBe(4);
    expect(result.itemsStored).toBe(3);

    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    expect(upserted).toHaveLength(3);
    const sharedItem = upserted.find((i) => i.url === shared);
    expect(sharedItem?.title).toBe("high");
  });

  it("enrichment called when provided, skipped otherwise", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async () => [makeResult({ url: "https://c.com/1" })]);

    const ctx: EnrichmentContext = {
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
      cache: new Map(),
      counters: {
        attempted: 0, ok: 0, failed: 0, skipped: 0, cacheHits: 0, totalFetchMs: 0,
        skippedReasons: new Map(),
      },
    };

    await collectWebSearch(
      { rawItemsRepo: repo, provider, enrichment: ctx },
      { provider: "tavily", queries: [{ query: "x", sinceDays: 7, maxItems: 1 }] },
    );
    expect(enrichSpy).toHaveBeenCalledTimes(1);

    enrichSpy.mockClear();
    await collectWebSearch(
      { rawItemsRepo: repo, provider },
      { provider: "tavily", queries: [{ query: "y", sinceDays: 7, maxItems: 1 }] },
    );
    expect(enrichSpy).not.toHaveBeenCalled();
  });

  it("pre-aborted signal: all queries report error, no items stored", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async () => [makeResult({ url: "https://nope.com/1" })]);
    const controller = new AbortController();
    controller.abort();

    const config: RunSubmitWebSearchConfig = {
      provider: "tavily",
      queries: [
        { query: "a", sinceDays: 7, maxItems: 3 },
        { query: "b", sinceDays: 7, maxItems: 3 },
      ],
    };

    const result = await collectWebSearch(
      { rawItemsRepo: repo, provider, signal: controller.signal },
      config,
    );

    expect(result.itemsStored).toBe(0);
    expect(result.itemsFetched).toBe(0);
    expect(provider.search).not.toHaveBeenCalled();
    expect(repo.upsertItems).not.toHaveBeenCalled();
    expect(result.unitResults).toHaveLength(2);
    expect(result.unitResults?.every((u) => u.errors.length > 0)).toBe(true);
  });

  it("externalId format: tavily: prefix + 64-hex sha256(url)", async () => {
    const repo = createMockRepo();
    const url = "https://ext.id/test";
    const provider = createMockProvider(async () => [makeResult({ url })]);

    await collectWebSearch(
      { rawItemsRepo: repo, provider },
      { provider: "tavily", queries: [{ query: "z", sinceDays: 7, maxItems: 1 }] },
    );

    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    expect(upserted[0]?.externalId).toBe(`tavily:${sha256Hex(url)}`);
    expect(upserted[0]?.externalId).toMatch(/^tavily:[0-9a-f]{64}$/);
  });

  it("metadata shape: provider, query, rawScore", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async (input) => [
      makeResult({ url: `https://m.com/${input.query}`, rawScore: 0.42 }),
    ]);

    await collectWebSearch(
      { rawItemsRepo: repo, provider },
      { provider: "tavily", queries: [{ query: "mq", sinceDays: 7, maxItems: 1 }] },
    );

    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    const meta = upserted[0]?.metadata as Record<string, unknown>;
    expect(meta.provider).toBe("tavily");
    expect(meta.query).toBe("mq");
    expect(meta.rawScore).toBe(0.42);
  });

  it("empty queries: returns immediately with itemsStored 0, no provider call", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async () => []);

    const result = await collectWebSearch(
      { rawItemsRepo: repo, provider },
      { provider: "tavily", queries: [] },
    );

    expect(result.itemsStored).toBe(0);
    expect(result.itemsFetched).toBe(0);
    expect(result.unitResults).toEqual([]);
    expect(provider.search).not.toHaveBeenCalled();
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  it("publishedAt fallback: null → collectedAt", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async () => [
      makeResult({ url: "https://pub.null/1", publishedAt: null }),
    ]);
    const before = Date.now();
    await collectWebSearch(
      { rawItemsRepo: repo, provider },
      { provider: "tavily", queries: [{ query: "pn", sinceDays: 7, maxItems: 1 }] },
    );
    const after = Date.now();

    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    const item = upserted[0];
    expect(item?.publishedAt).toBeInstanceOf(Date);
    expect(item?.publishedAt).toEqual(item?.collectedAt);
    const t = (item?.publishedAt as Date).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("sourceType is 'web_search' on every produced item", async () => {
    const repo = createMockRepo();
    const provider = createMockProvider(async () => [
      makeResult({ url: "https://s.com/1" }),
      makeResult({ url: "https://s.com/2" }),
    ]);

    await collectWebSearch(
      { rawItemsRepo: repo, provider },
      { provider: "tavily", queries: [{ query: "s", sinceDays: 7, maxItems: 2 }] },
    );

    const upserted = repo.upsertItems.mock.calls[0]?.[0] ?? [];
    expect(upserted).toHaveLength(2);
    expect(upserted.every((i) => i.sourceType === "web_search")).toBe(true);
  });
});
