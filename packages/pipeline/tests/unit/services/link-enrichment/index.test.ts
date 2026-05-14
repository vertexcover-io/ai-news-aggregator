import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import type { RawItemInsert } from "@newsletter/shared";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";
import { newCounters, type EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";
import { createEnrichmentCache } from "@pipeline/services/link-enrichment/cache.js";

const fetchAdaptiveMock = vi.hoisted(() => vi.fn());

vi.mock("@pipeline/services/web-fetch/fetch-adaptive.js", () => ({
  fetchAdaptive: fetchAdaptiveMock,
}));

const { enrichRawItems, toEnrichmentTelemetry } = await import(
  "@pipeline/services/link-enrichment/index.js"
);

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

function makeCtx(signal?: AbortSignal): EnrichmentContext {
  return {
    logger: stubLogger(),
    cache: createEnrichmentCache(),
    counters: newCounters(),
    signal,
  };
}

function makeItem(url: string): RawItemInsert {
  return {
    sourceType: "reddit",
    externalId: `e-${Math.random()}`,
    title: "t",
    url,
  } as RawItemInsert;
}

describe("enrichRawItems", () => {
  beforeEach(() => {
    fetchAdaptiveMock.mockReset();
  });

  it("calls fetchAdaptive once for duplicate URLs and marks the second as cacheHit (VS-4)", async () => {
    const result: ConvertResult = {
      markdown: "body",
      title: "Title",
      byline: null,
      imageUrl: null,
      textLength: 4,
    };
    fetchAdaptiveMock.mockResolvedValue(result);

    const ctx = makeCtx();
    const items = [
      makeItem("https://example.com/article"),
      makeItem("https://example.com/article"),
    ];
    await enrichRawItems(items, ctx);

    expect(fetchAdaptiveMock).toHaveBeenCalledTimes(1);
    expect(items[0].metadata?.enrichedLink?.status).toBe("ok");
    expect(items[0].metadata?.enrichedLink?.cacheHit).toBeFalsy();
    expect(items[1].metadata?.enrichedLink?.status).toBe("ok");
    expect(items[1].metadata?.enrichedLink?.cacheHit).toBe(true);
    expect(items[1].metadata?.enrichedLink?.title).toBe("Title");
    expect(ctx.counters.ok).toBe(2);
    expect(ctx.counters.cacheHits).toBe(1);
    expect(ctx.counters.attempted).toBe(1);
  });

  it("marks remaining items as cancelled when signal aborts mid-iteration (VS-7)", async () => {
    const controller = new AbortController();
    const result: ConvertResult = {
      markdown: "body",
      title: "T",
      byline: null,
      imageUrl: null,
      textLength: 4,
    };
    fetchAdaptiveMock.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(result);
    });

    const ctx = makeCtx(controller.signal);
    const items = [
      makeItem("https://example.com/a"),
      makeItem("https://example.com/b"),
      makeItem("https://example.com/c"),
    ];
    await enrichRawItems(items, ctx);

    expect(items[0].metadata?.enrichedLink?.status).toBe("ok");
    expect(items[1].metadata?.enrichedLink?.status).toBe("failed");
    expect(items[1].metadata?.enrichedLink?.failureReason).toBe("cancelled");
    expect(items[2].metadata?.enrichedLink?.status).toBe("failed");
    expect(items[2].metadata?.enrichedLink?.failureReason).toBe("cancelled");
  });

  it("skips media URLs without invoking fetchAdaptive (VS-5)", async () => {
    const ctx = makeCtx();
    const items = [
      makeItem("https://example.com/paper.pdf"),
      makeItem("https://youtube.com/watch?v=abc"),
    ];
    await enrichRawItems(items, ctx);
    expect(fetchAdaptiveMock).not.toHaveBeenCalled();
    expect(items[0].metadata?.enrichedLink?.skipReason).toBe("non-html-media");
    expect(items[1].metadata?.enrichedLink?.skipReason).toBe("non-html-media");
    expect(ctx.counters.skipped).toBe(2);
    expect(ctx.counters.skippedReasons.get("non-html-media")).toBe(2);
  });
});

describe("toEnrichmentTelemetry", () => {
  it("converts counters to a flat telemetry object with avgFetchMs", () => {
    const counters = newCounters();
    counters.attempted = 5;
    counters.ok = 2;
    counters.failed = 1;
    counters.skipped = 2;
    counters.cacheHits = 1;
    counters.totalFetchMs = 600;
    counters.skippedReasons.set("no-url", 1);
    counters.skippedReasons.set("non-html-media", 1);

    const t = toEnrichmentTelemetry(counters);
    expect(t).toEqual({
      attempted: 5,
      ok: 2,
      failed: 1,
      skipped: 2,
      cacheHits: 1,
      avgFetchMs: 200,
      skippedReasons: { "no-url": 1, "non-html-media": 1 },
    });
  });

  it("avgFetchMs uses 1 as divisor when no fetches happened", () => {
    const counters = newCounters();
    const t = toEnrichmentTelemetry(counters);
    expect(t.avgFetchMs).toBe(0);
  });
});
