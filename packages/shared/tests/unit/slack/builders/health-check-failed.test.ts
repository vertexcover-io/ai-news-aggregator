import { describe, it, expect } from "vitest";
import { buildHealthCheckFailedBlocks } from "@shared/slack/builders/health-check-failed.js";
import type { HealthCheckResult } from "@shared/types/health-check.js";

function makeResult(overrides: Partial<HealthCheckResult> & { collector: HealthCheckResult["collector"] }): HealthCheckResult {
  return {
    collector: overrides.collector,
    status: overrides.status ?? "healthy",
    durationMs: overrides.durationMs ?? 123,
    itemsFound: overrides.itemsFound,
    error: overrides.error,
    reason: overrides.reason,
  };
}

describe("buildHealthCheckFailedBlocks", () => {
  it("renders header block with correct text", () => {
    const { blocks } = buildHealthCheckFailedBlocks({
      results: [],
      totalDurationMs: 0,
      failedCount: 0,
      healthyCount: 0,
      skippedCount: 0,
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("🩺 Collector Health Check Failed");
  });

  it("shows 'All collectors healthy' message when no failures", () => {
    const results: HealthCheckResult[] = [
      makeResult({ collector: "hn", status: "healthy", durationMs: 100 }),
      makeResult({ collector: "reddit", status: "healthy", durationMs: 200 }),
    ];
    const { blocks } = buildHealthCheckFailedBlocks({
      results,
      totalDurationMs: 300,
      failedCount: 0,
      healthyCount: 2,
      skippedCount: 0,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const allHealthy = sections.find((s) =>
      s.text.text.includes("All collectors healthy"),
    );
    expect(allHealthy).toBeDefined();
  });

  it("renders a single failed collector with its error message", () => {
    const results: HealthCheckResult[] = [
      makeResult({ collector: "twitter", status: "healthy", durationMs: 50 }),
      makeResult({
        collector: "hn",
        status: "failed",
        durationMs: 500,
        error: "Algolia API returned 500",
      }),
    ];
    const { blocks } = buildHealthCheckFailedBlocks({
      results,
      totalDurationMs: 550,
      failedCount: 1,
      healthyCount: 1,
      skippedCount: 0,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const failuresSection = sections.find((s) =>
      s.text.text.includes("Failed collectors"),
    );
    expect(failuresSection).toBeDefined();
    expect(failuresSection?.text.text).toContain("hn");
    expect(failuresSection?.text.text).toContain("Algolia API returned 500");
  });

  it("renders multiple failed collectors each with their error", () => {
    const results: HealthCheckResult[] = [
      makeResult({
        collector: "twitter",
        status: "failed",
        durationMs: 300,
        error: "Invalid cookies — rotate at /admin/settings",
      }),
      makeResult({
        collector: "reddit",
        status: "failed",
        durationMs: 400,
        error: "RSS XML structure changed",
      }),
      makeResult({ collector: "hn", status: "healthy", durationMs: 100 }),
    ];
    const { blocks } = buildHealthCheckFailedBlocks({
      results,
      totalDurationMs: 800,
      failedCount: 2,
      healthyCount: 1,
      skippedCount: 0,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const failuresSection = sections.find((s) =>
      s.text.text.includes("Failed collectors"),
    );
    expect(failuresSection).toBeDefined();
    expect(failuresSection?.text.text).toContain("twitter");
    expect(failuresSection?.text.text).toContain("Invalid cookies");
    expect(failuresSection?.text.text).toContain("reddit");
    expect(failuresSection?.text.text).toContain("RSS XML structure changed");
  });

  it("includes summary line with healthy, failed, skipped counts", () => {
    const results: HealthCheckResult[] = [
      makeResult({ collector: "hn", status: "healthy", durationMs: 100 }),
      makeResult({
        collector: "twitter",
        status: "failed",
        durationMs: 300,
        error: "timeout",
      }),
      makeResult({
        collector: "web_search",
        status: "skipped",
        durationMs: 0,
        reason: "API key not configured",
      }),
    ];
    const { blocks } = buildHealthCheckFailedBlocks({
      results,
      totalDurationMs: 400,
      failedCount: 1,
      healthyCount: 1,
      skippedCount: 1,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const summary = sections.find((s) =>
      s.text.text.includes("Summary"),
    );
    expect(summary).toBeDefined();
    expect(summary?.text.text).toContain("1 healthy");
    expect(summary?.text.text).toContain("1 failed");
    expect(summary?.text.text).toContain("1 skipped");
  });

  it("skipped collectors are excluded from failure blocks", () => {
    const results: HealthCheckResult[] = [
      makeResult({
        collector: "blog",
        status: "skipped",
        durationMs: 0,
        reason: "no sources configured",
      }),
      makeResult({ collector: "hn", status: "healthy", durationMs: 100 }),
    ];
    const { blocks } = buildHealthCheckFailedBlocks({
      results,
      totalDurationMs: 100,
      failedCount: 0,
      healthyCount: 1,
      skippedCount: 1,
    });
    const text = JSON.stringify(blocks);
    expect(text).not.toContain("Failed collectors");
  });

  it("does not include a context block (not run-specific)", () => {
    const { blocks } = buildHealthCheckFailedBlocks({
      results: [],
      totalDurationMs: 0,
      failedCount: 0,
      healthyCount: 0,
      skippedCount: 0,
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    );
    expect(context).toBeUndefined();
  });
});
