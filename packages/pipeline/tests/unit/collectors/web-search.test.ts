import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { WebSearchProvider, WebSearchResult } from "@pipeline/collectors/web-search/providers/index.js";
import type { WebSearchCollectorDeps } from "@pipeline/collectors/web-search/index.js";
import type { RunSubmitWebSearchConfig, WebSearchQueryConfig } from "@newsletter/shared/types";

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

const enrichRawItemsMock = vi.hoisted(() => vi.fn());
vi.mock("@pipeline/services/link-enrichment/index.js", () => ({
  enrichRawItems: enrichRawItemsMock,
}));

const { collectWebSearch } = await import("@pipeline/collectors/web-search/index.js");

type MockUpsert = ReturnType<typeof vi.fn<[items: RawItemInsert[]], Promise<void>>>;

function createMockRepo(): RawItemsRepo & { upsertItems: MockUpsert } {
  return {
    upsertItems: vi.fn<[items: RawItemInsert[]], Promise<void>>().mockResolvedValue(undefined),
    findExistingExternalIds: vi.fn(),
    findBySourceAndExternalId: vi.fn(),
    findByIds: vi.fn(),
    updateRecapData: vi.fn(),
  };
}

function makeResult(url: string, rawScore = 0.5): WebSearchResult {
  return {
    url,
    title: `Title for ${url}`,
    snippet: `Snippet for ${url}`,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    rawScore,
  };
}

function makeProvider(
  resultsPerQuery: WebSearchResult[][] | ((query: string) => WebSearchResult[] | Error),
): WebSearchProvider & { search: ReturnType<typeof vi.fn> } {
  let callIdx = 0;
  const searchFn = vi.fn().mockImplementation(({ query }: { query: string }) => {
    if (typeof resultsPerQuery === "function") {
      const result = resultsPerQuery(query);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }
    const results = resultsPerQuery[callIdx] ?? [];
    callIdx++;
    return Promise.resolve(results);
  });
  return { name: "tavily", search: searchFn };
}

function makeConfig(queries: WebSearchQueryConfig[]): RunSubmitWebSearchConfig {
  return { provider: "tavily", queries };
}

function sha256(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

describe("collectWebSearch", () => {
  let repo: RawItemsRepo & { upsertItems: MockUpsert };

  beforeEach(() => {
    repo = createMockRepo();
    enrichRawItemsMock.mockReset();
    enrichRawItemsMock.mockResolvedValue([]);
  });

  // REQ-004 happy path
  it("happy path: 2 queries × 3 results each → itemsFetched: 6, itemsStored: 6", async () => {
    const q1Results = [
      makeResult("https://a.com/1"),
      makeResult("https://a.com/2"),
      makeResult("https://a.com/3"),
    ];
    const q2Results = [
      makeResult("https://b.com/1"),
      makeResult("https://b.com/2"),
      makeResult("https://b.com/3"),
    ];
    const provider = makeProvider([q1Results, q2Results]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([
      { query: "agentic AI", sinceDays: 7, maxItems: 5 },
      { query: "context engineering", sinceDays: 7, maxItems: 5 },
    ]);

    const result: CollectorResult = await collectWebSearch(deps, config);

    expect(result.itemsFetched).toBe(6);
    expect(result.itemsStored).toBe(6);
    expect(result.commentsFetched).toBe(0);
    expect(typeof result.durationMs).toBe("number");
    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(provider.search).toHaveBeenCalledWith({ query: "agentic AI", sinceDays: 7, maxItems: 5, signal: undefined });
    expect(provider.search).toHaveBeenCalledWith({ query: "context engineering", sinceDays: 7, maxItems: 5, signal: undefined });
  });

  // Per-query failure isolation
  it("per-query failure isolation: query A throws, query B returns 2 → itemsStored: 2, one error entry", async () => {
    const provider = makeProvider((query: string) => {
      if (query === "failing query") return new Error("boom");
      return [makeResult("https://ok.com/1"), makeResult("https://ok.com/2")];
    });

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([
      { query: "failing query", sinceDays: 7, maxItems: 5 },
      { query: "good query", sinceDays: 7, maxItems: 5 },
    ]);

    const result: CollectorResult = await collectWebSearch(deps, config);

    expect(result.itemsStored).toBe(2);
    expect(result.unitResults).toBeDefined();

    const errorEntry = result.unitResults?.find((r) => r.status === "failed");
    const successEntry = result.unitResults?.find((r) => r.status === "completed");

    expect(errorEntry).toBeDefined();
    expect(errorEntry?.errors[0]).toContain("boom");
    expect(successEntry).toBeDefined();
    expect(successEntry?.itemsFetched).toBe(2);
  });

  // URL dedup across queries
  it("URL dedup: shared URL with different scores → only higher-score item kept", async () => {
    const sharedUrl = "https://shared.com/article";
    const q1Results = [
      makeResult("https://unique1.com/a", 0.9),
      { ...makeResult(sharedUrl, 0.3) }, // low score
    ];
    const q2Results = [
      makeResult("https://unique2.com/b", 0.7),
      { ...makeResult(sharedUrl, 0.8) }, // higher score — should win
    ];
    const provider = makeProvider([q1Results, q2Results]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([
      { query: "query one", sinceDays: 7, maxItems: 5 },
      { query: "query two", sinceDays: 7, maxItems: 5 },
    ]);

    const result: CollectorResult = await collectWebSearch(deps, config);

    expect(result.itemsFetched).toBe(4);
    expect(result.itemsStored).toBe(3);

    const upsertedItems = repo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    const deduped = upsertedItems.find((i) => i.url === sharedUrl);
    expect(deduped).toBeDefined();
    expect((deduped?.metadata as { rawScore?: number }).rawScore).toBe(0.8);
  });

  // Enrichment called
  it("enrichment: enrichRawItems called with all items when enrichment context provided", async () => {
    const results = [makeResult("https://enrich.com/a"), makeResult("https://enrich.com/b")];
    const provider = makeProvider([results]);

    const mockEnrichment = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() },
      cache: new Map(),
      counters: {
        attempted: 0, ok: 0, failed: 0, skipped: 0, cacheHits: 0, totalFetchMs: 0,
        skippedReasons: new Map(),
      },
      signal: undefined,
    };

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider, enrichment: mockEnrichment as unknown as Parameters<typeof collectWebSearch>[0]["enrichment"] };
    const config = makeConfig([{ query: "test enrichment", sinceDays: 7, maxItems: 5 }]);

    await collectWebSearch(deps, config);

    expect(enrichRawItemsMock).toHaveBeenCalledTimes(1);
    const [calledItems] = enrichRawItemsMock.mock.calls[0] as [RawItemInsert[]];
    expect(calledItems).toHaveLength(2);
  });

  // AbortSignal pre-aborted
  it("pre-aborted signal: all queries result in errors, no items stored", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = makeProvider((query: string) => {
      return new Error(`Aborted: ${query}`);
    });

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider, signal: controller.signal };
    const config = makeConfig([
      { query: "query A", sinceDays: 7, maxItems: 5 },
      { query: "query B", sinceDays: 7, maxItems: 5 },
    ]);

    const result: CollectorResult = await collectWebSearch(deps, config);

    expect(result.itemsStored).toBe(0);
    expect(repo.upsertItems).not.toHaveBeenCalled();
    const failedEntries = result.unitResults?.filter((r) => r.status === "failed") ?? [];
    expect(failedEntries.length).toBe(2);
  });

  // externalId format
  it("externalId format: tavily: prefix + 64-char hex sha256 of URL", async () => {
    const url = "https://example.com/article/123";
    const provider = makeProvider([[makeResult(url)]]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([{ query: "test", sinceDays: 7, maxItems: 5 }]);

    await collectWebSearch(deps, config);

    const upsertedItems = repo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    const item = upsertedItems[0];
    expect(item).toBeDefined();
    expect(item?.externalId).toMatch(/^tavily:[0-9a-f]{64}$/);
    expect(item?.externalId).toBe(`tavily:${sha256(url)}`);
  });

  // metadata shape
  it("metadata shape: provider, query, rawScore present on each item", async () => {
    const url = "https://meta.com/article";
    const queryStr = "metadata query";
    const provider = makeProvider([[{ ...makeResult(url, 0.75), rawScore: 0.75 }]]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([{ query: queryStr, sinceDays: 7, maxItems: 5 }]);

    await collectWebSearch(deps, config);

    const upsertedItems = repo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    const item = upsertedItems[0];
    expect(item).toBeDefined();
    const meta = item?.metadata as { provider?: string; query?: string; rawScore?: number };
    expect(meta.provider).toBe("tavily");
    expect(meta.query).toBe(queryStr);
    expect(meta.rawScore).toBe(0.75);
  });

  // Empty queries config
  it("empty queries config: returns itemsStored: 0 immediately, provider never called", async () => {
    const provider = makeProvider([]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([]);

    const result: CollectorResult = await collectWebSearch(deps, config);

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.commentsFetched).toBe(0);
    expect(provider.search).not.toHaveBeenCalled();
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // sourceType field
  it("sourceType is 'web_search' on all upserted items", async () => {
    const provider = makeProvider([[makeResult("https://src.com/a")]]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([{ query: "source type test", sinceDays: 7, maxItems: 5 }]);

    await collectWebSearch(deps, config);

    const upsertedItems = repo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    expect(upsertedItems.every((i) => i.sourceType === "web_search")).toBe(true);
  });

  // publishedAt fallback
  it("publishedAt falls back to current date when result.publishedAt is null", async () => {
    const before = new Date();
    const result: WebSearchResult = {
      url: "https://fallback.com/article",
      title: "Fallback article",
      snippet: "snippet",
      publishedAt: null,
    };
    const provider = makeProvider([[result]]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([{ query: "date fallback", sinceDays: 7, maxItems: 5 }]);

    await collectWebSearch(deps, config);
    const after = new Date();

    const upsertedItems = repo.upsertItems.mock.calls[0][0] as RawItemInsert[];
    const item = upsertedItems[0];
    expect(item?.publishedAt).toBeInstanceOf(Date);
    if (!(item?.publishedAt instanceof Date)) throw new Error("publishedAt must be a Date");
    expect(item.publishedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(item.publishedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  // unitResults structure
  it("unitResults has one entry per query with correct fields", async () => {
    const provider = makeProvider([
      [makeResult("https://unit1.com/a"), makeResult("https://unit1.com/b")],
      [makeResult("https://unit2.com/a")],
    ]);

    const deps: WebSearchCollectorDeps = { rawItemsRepo: repo, provider };
    const config = makeConfig([
      { query: "query one", sinceDays: 7, maxItems: 5 },
      { query: "query two", sinceDays: 7, maxItems: 5 },
    ]);

    const result: CollectorResult = await collectWebSearch(deps, config);

    expect(result.unitResults).toHaveLength(2);
    const [unit1, unit2] = result.unitResults ?? [];
    expect(unit1?.status).toBe("completed");
    expect(unit1?.itemsFetched).toBe(2);
    expect(unit2?.status).toBe("completed");
    expect(unit2?.itemsFetched).toBe(1);
  });
});
