import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EnrichedLinkContent, RawItemInsert } from "@newsletter/shared";
import type { Logger } from "@newsletter/shared/logger";
import type {
  RunLogFields,
  RunLogger,
} from "@pipeline/services/run-logger.js";
import {
  newCounters,
  type EnrichmentContext,
} from "@pipeline/services/link-enrichment/types.js";

const enrichOneMock = vi.fn();

vi.mock("@pipeline/services/link-enrichment/fetcher.js", () => ({
  enrichOne: enrichOneMock,
}));

// Import AFTER vi.mock so the mocked enrichOne is used.
const { enrichRawItems } = await import(
  "@pipeline/services/link-enrichment/index.js"
);

type RunLoggerCalls = Record<
  "debug" | "info" | "warn" | "error",
  [RunLogFields, string][]
>;

function makeRunLogger(): { runLogger: RunLogger; calls: RunLoggerCalls } {
  const calls: RunLoggerCalls = { debug: [], info: [], warn: [], error: [] };
  const make = (level: keyof RunLoggerCalls) =>
    vi.fn((fields: RunLogFields, message: string): Promise<void> => {
      calls[level].push([fields, message]);
      return Promise.resolve();
    });
  const runLogger: RunLogger = {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
  };
  return { runLogger, calls };
}

function makeLogger(): Logger {
  const noop = (): void => {
    /* noop */
  };
  const logger = { debug: noop, info: noop, warn: noop, error: noop };
  return logger as unknown as Logger;
}

function makeItem(overrides: Partial<RawItemInsert> = {}): RawItemInsert {
  return {
    sourceType: "reddit",
    externalId: "abc123",
    title: "Some post",
    url: "https://example.com/article",
    sourceUrl: "https://reddit.com/r/x/comments/abc123",
    ...overrides,
  } as RawItemInsert;
}

function makeCtx(
  runLogger: RunLogger | undefined,
  signal?: AbortSignal,
): EnrichmentContext {
  return {
    logger: makeLogger(),
    signal,
    cache: new Map<string, EnrichedLinkContent>(),
    counters: newCounters(),
    runLogger,
  };
}

beforeEach(() => {
  enrichOneMock.mockReset();
});

describe("enrichRawItems failure logging", () => {
  it("VS-3 catch-block path emits link_enrichment.failed at error level", async () => {
    enrichOneMock.mockImplementation(() => {
      throw new Error("network boom");
    });
    const { runLogger, calls } = makeRunLogger();
    const ctx = makeCtx(runLogger);
    const item = makeItem({ url: "https://example.com/article" });

    await enrichRawItems([item], ctx);

    expect(calls.error).toHaveLength(1);
    const [fields, msg] = calls.error[0];
    expect(fields.event).toBe("link_enrichment.failed");
    expect(fields.stage).toBe("enrich");
    expect(fields.source).toBe(item.sourceType);
    expect(fields.url).toBe(item.url);
    expect(fields.step).toBe("enrich");
    const failureReason = fields.failureReason;
    expect(typeof failureReason).toBe("string");
    expect(typeof failureReason === "string" && failureReason.length > 0).toBe(
      true,
    );
    expect(fields.originatingCollector).toBe(item.sourceType);
    expect(msg).toContain("link enrichment failed");
    expect(msg).toContain("example.com");
  });

  it("VS-3 non-ok enrichOne result emits link_enrichment.failed at error level", async () => {
    enrichOneMock.mockResolvedValue({
      url: "https://example.com/article",
      fetchedAt: new Date().toISOString(),
      status: "failed",
      failureReason: "timeout",
    } satisfies EnrichedLinkContent);
    const { runLogger, calls } = makeRunLogger();
    const ctx = makeCtx(runLogger);
    const item = makeItem();

    await enrichRawItems([item], ctx);

    expect(calls.error).toHaveLength(1);
    const [fields] = calls.error[0];
    expect(fields.event).toBe("link_enrichment.failed");
    expect(fields.failureReason).toBe("timeout");
    expect(fields.url).toBe(item.url);
  });

  it("VS-3 cancelled branch emits link_enrichment.failed at error level", async () => {
    const controller = new AbortController();
    controller.abort();
    const { runLogger, calls } = makeRunLogger();
    const ctx = makeCtx(runLogger, controller.signal);
    const item = makeItem();

    await enrichRawItems([item], ctx);

    expect(calls.error).toHaveLength(1);
    const [fields] = calls.error[0];
    expect(fields.event).toBe("link_enrichment.failed");
    expect(fields.failureReason).toBe("cancelled");
    expect(fields.stage).toBe("enrich");
  });

  it("VS-4 successful enrichment emits zero error and zero warn rows", async () => {
    enrichOneMock.mockResolvedValue({
      url: "https://example.com/article",
      fetchedAt: new Date().toISOString(),
      status: "ok",
      title: "ok",
      markdown: "hi",
      textLength: 2,
    } satisfies EnrichedLinkContent);
    const { runLogger, calls } = makeRunLogger();
    const ctx = makeCtx(runLogger);
    const item = makeItem();

    await enrichRawItems([item], ctx);

    expect(calls.error).toHaveLength(0);
    expect(calls.warn).toHaveLength(0);
  });
});
