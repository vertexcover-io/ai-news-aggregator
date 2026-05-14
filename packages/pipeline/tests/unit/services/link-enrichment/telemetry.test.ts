import { describe, expect, it } from "vitest";
import { newCounters } from "@pipeline/services/link-enrichment/types.js";
import { toEnrichmentTelemetry } from "@pipeline/services/link-enrichment/index.js";

describe("VS-9: telemetry shape from mixed counters", () => {
  it("reflects 1 ok-fresh + 1 cache-hit + 2 skipped (mixed reasons) + 1 failed", () => {
    const counters = newCounters();
    // 1 fresh ok + 1 failed both bump `attempted`; cache hit does not.
    counters.attempted = 2;
    // 1 fresh ok + 1 cache hit
    counters.ok = 2;
    counters.cacheHits = 1;
    counters.failed = 1;
    counters.skipped = 2;
    counters.totalFetchMs = 400;
    counters.skippedReasons.set("no-url", 1);
    counters.skippedReasons.set("non-html-media", 1);

    const t = toEnrichmentTelemetry(counters);

    expect(t.attempted).toBe(2);
    expect(t.ok).toBe(2);
    expect(t.failed).toBe(1);
    expect(t.skipped).toBe(2);
    expect(t.cacheHits).toBe(1);
    // avgFetchMs = totalFetchMs / max(1, ok+failed) = 400 / 3 = 133
    expect(t.avgFetchMs).toBe(Math.round(400 / 3));
    expect(t.skippedReasons).toEqual({ "no-url": 1, "non-html-media": 1 });
  });

  it("returns zeros and empty skippedReasons for fresh counters", () => {
    const t = toEnrichmentTelemetry(newCounters());
    expect(t).toEqual({
      attempted: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      cacheHits: 0,
      avgFetchMs: 0,
      skippedReasons: {},
    });
  });
});
