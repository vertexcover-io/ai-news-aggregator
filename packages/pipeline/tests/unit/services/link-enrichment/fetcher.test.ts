import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import type { ConvertResult } from "@pipeline/services/web-fetch/types.js";
import { newCounters, type EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

const fetchAdaptiveMock = vi.hoisted(() => vi.fn());

vi.mock("@pipeline/services/web-fetch/fetch-adaptive.js", () => ({
  fetchAdaptive: fetchAdaptiveMock,
}));

const { enrichOne } = await import("@pipeline/services/link-enrichment/fetcher.js");

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
    cache: new Map(),
    counters: newCounters(),
    signal,
  };
}

describe("enrichOne", () => {
  beforeEach(() => {
    fetchAdaptiveMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("truncates markdown > 100k and preserves textLength (VS-11)", async () => {
    const big = "a".repeat(250_000);
    const result: ConvertResult = {
      markdown: big,
      title: "Title",
      byline: null,
      imageUrl: null,
      textLength: 250_000,
    };
    fetchAdaptiveMock.mockResolvedValueOnce(result);

    const ctx = makeCtx();
    const enriched = await enrichOne(
      "https://example.com/article",
      "https://example.com/article",
      ctx,
    );

    expect(enriched.status).toBe("ok");
    expect(enriched.markdown?.length).toBe(100_000);
    expect(enriched.textLength).toBe(250_000);
    expect(enriched.title).toBe("Title");
    expect(enriched.domain).toBe("example.com");
    expect(enriched.contentType).toBe("html");
    expect(ctx.counters.totalFetchMs).toBeGreaterThanOrEqual(0);
  });

  it("maps timeout to failureReason: 'timeout' (VS-6)", async () => {
    fetchAdaptiveMock.mockImplementationOnce(async (_url: string, _mode: string, opts: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        if (opts.signal?.aborted) {
          const err = new Error("aborted");
          err.name = "TimeoutError";
          reject(err);
          return;
        }
        opts.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "TimeoutError";
          reject(err);
        });
      });
    });

    const ctx = makeCtx();
    const enriched = await enrichOne(
      "https://example.com/slow",
      "https://example.com/slow",
      ctx,
    );

    expect(enriched.status).toBe("failed");
    expect(enriched.failureReason).toBe("timeout");
    expect(enriched.domain).toBe("example.com");
  }, 20_000);

  it("maps HTTP errors to http_<code>", async () => {
    fetchAdaptiveMock.mockRejectedValueOnce(new Error("HTTP 503 for https://example.com"));
    const ctx = makeCtx();
    const enriched = await enrichOne(
      "https://example.com/x",
      "https://example.com/x",
      ctx,
    );
    expect(enriched.status).toBe("failed");
    expect(enriched.failureReason).toBe("http_503");
  });

  it("maps ctx.signal abort to failureReason: 'cancelled'", async () => {
    const controller = new AbortController();
    fetchAdaptiveMock.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    const ctx = makeCtx(controller.signal);
    const enriched = await enrichOne(
      "https://example.com/x",
      "https://example.com/x",
      ctx,
    );
    expect(enriched.status).toBe("failed");
    expect(enriched.failureReason).toBe("cancelled");
  });
});
