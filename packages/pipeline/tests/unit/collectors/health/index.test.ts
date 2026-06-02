import { describe, expect, it, vi } from "vitest";
import { runAllHealthChecks } from "@pipeline/collectors/health/index.js";
import type { HealthCheckResult } from "@newsletter/shared/types";

describe("runAllHealthChecks", () => {
  const healthyResult: HealthCheckResult = { collector: "hn", status: "healthy", durationMs: 10, itemsFound: 1 };
  const failedResult: HealthCheckResult = { collector: "reddit", status: "failed", durationMs: 10, error: "network error" };
  const skippedResult: HealthCheckResult = { collector: "twitter", status: "skipped", durationMs: 2, reason: "not configured" };

  it("returns a report with all results when all are healthy", async () => {
    const results = await runAllHealthChecks({
      hn: vi.fn().mockResolvedValue(healthyResult),
      reddit: vi.fn().mockResolvedValue(healthyResult),
      twitter: vi.fn().mockResolvedValue(healthyResult),
      webSearch: vi.fn().mockResolvedValue(healthyResult),
      blog: vi.fn().mockResolvedValue(healthyResult),
    });

    expect(results.results).toHaveLength(5);
    expect(results.healthyCount).toBe(5);
    expect(results.failedCount).toBe(0);
    expect(results.skippedCount).toBe(0);
    expect(results.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports mixed results with healthy, failed, and skipped", async () => {
    const results = await runAllHealthChecks({
      hn: vi.fn().mockResolvedValue(healthyResult),
      reddit: vi.fn().mockResolvedValue(failedResult),
      twitter: vi.fn().mockResolvedValue(skippedResult),
      webSearch: vi.fn().mockResolvedValue(healthyResult),
      blog: vi.fn().mockResolvedValue(healthyResult),
    });

    expect(results.healthyCount).toBe(3);
    expect(results.failedCount).toBe(1);
    expect(results.skippedCount).toBe(1);
    expect(results.results.find((r) => r.collector === "reddit")?.status).toBe("failed");
    expect(results.results.find((r) => r.collector === "twitter")?.status).toBe("skipped");
  });

  it("runs a single collector when collectorType is specified", async () => {
    const healthFns = {
      hn: vi.fn().mockResolvedValue(healthyResult),
      reddit: vi.fn().mockResolvedValue(healthyResult),
    };
    const results = await runAllHealthChecks(healthFns, { collectorType: "hn" });

    expect(results.results).toHaveLength(1);
    expect(results.results[0].collector).toBe("hn");
    expect(healthFns.reddit).not.toHaveBeenCalled();
  });

  it("reports all failed when all checks fail", async () => {
    const makeFailed = (collector: string) =>
      vi.fn().mockResolvedValue({ collector, status: "failed" as const, durationMs: 10, error: "fail" });
    const results = await runAllHealthChecks({
      hn: makeFailed("hn"),
      reddit: makeFailed("reddit"),
      twitter: makeFailed("twitter"),
      webSearch: makeFailed("web_search"),
      blog: makeFailed("blog"),
    });

    expect(results.failedCount).toBe(5);
    expect(results.healthyCount).toBe(0);
  });

  it("runs checks in parallel via Promise.allSettled", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const makeFn = () => vi.fn().mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCalls--;
      return healthyResult;
    });

    await runAllHealthChecks({
      hn: makeFn(),
      reddit: makeFn(),
      twitter: makeFn(),
      webSearch: makeFn(),
      blog: makeFn(),
    });

    // The checks should run concurrently, so at some point maxConcurrent should be > 1
    // With 5 checks and 10ms delay each, they should all start within one event loop tick
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });
});
