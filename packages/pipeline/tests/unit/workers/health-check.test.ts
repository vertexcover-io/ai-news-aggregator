import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import { handleHealthCheckJob } from "@pipeline/workers/health-check.js";
import type { HealthCheckReport, HealthCheckResult } from "@newsletter/shared/types";

function makeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: (): Logger => makeLogger(),
  } as unknown as Logger;
}

const healthyResult: HealthCheckResult = { collector: "hn", status: "healthy", durationMs: 5, itemsFound: 1 };
const failedResult: HealthCheckResult = { collector: "reddit", status: "failed", durationMs: 5, error: "network error" };
const skippedResult: HealthCheckResult = { collector: "twitter", status: "skipped", durationMs: 2, reason: "not configured" };

describe("handleHealthCheckJob", () => {
  it("noops for non health-check jobs", async () => {
    const runHealthChecks = vi.fn();
    const notifyHealthCheckFailed = vi.fn();

    await handleHealthCheckJob(
      {
        runHealthChecks,
        notifyHealthCheckFailed,
        checkDebounce: vi.fn().mockResolvedValue(false),
        logger: makeLogger(),
      },
      { name: "daily-run", id: "job-1", data: {} },
    );

    expect(runHealthChecks).not.toHaveBeenCalled();
    expect(notifyHealthCheckFailed).not.toHaveBeenCalled();
  });

  it("runs all health checks and does not send Slack when all are healthy", async () => {
    const report: HealthCheckReport = {
      results: [healthyResult, healthyResult, healthyResult],
      totalDurationMs: 15,
      healthyCount: 3,
      failedCount: 0,
      skippedCount: 0,
    };
    const runHealthChecks = vi.fn().mockResolvedValue(report);
    const notifyHealthCheckFailed = vi.fn();
    const markDebounce = vi.fn();

    await handleHealthCheckJob(
      {
        runHealthChecks,
        notifyHealthCheckFailed,
        checkDebounce: vi.fn().mockResolvedValue(false),
        markDebounce,
        logger: makeLogger(),
      },
      { name: "health-check", id: "job-1", data: { triggeredBy: "scheduled" } },
    );

    expect(runHealthChecks).toHaveBeenCalledOnce();
    expect(notifyHealthCheckFailed).not.toHaveBeenCalled();
    expect(markDebounce).not.toHaveBeenCalled();
  });

  it("sends Slack notification when there are failures", async () => {
    const report: HealthCheckReport = {
      results: [healthyResult, failedResult, skippedResult],
      totalDurationMs: 20,
      healthyCount: 1,
      failedCount: 1,
      skippedCount: 1,
    };
    const runHealthChecks = vi.fn().mockResolvedValue(report);
    const notifyHealthCheckFailed = vi.fn();
    const markDebounce = vi.fn();

    await handleHealthCheckJob(
      {
        runHealthChecks,
        notifyHealthCheckFailed,
        checkDebounce: vi.fn().mockResolvedValue(false),
        markDebounce,
        logger: makeLogger(),
      },
      { name: "health-check", id: "job-1", data: { triggeredBy: "scheduled" } },
    );

    expect(notifyHealthCheckFailed).toHaveBeenCalledWith({ report });
    expect(markDebounce).toHaveBeenCalledOnce();
  });

  it("skips Slack notification when debounced", async () => {
    const report: HealthCheckReport = {
      results: [healthyResult, failedResult],
      totalDurationMs: 20,
      healthyCount: 1,
      failedCount: 1,
      skippedCount: 0,
    };
    const runHealthChecks = vi.fn().mockResolvedValue(report);
    const notifyHealthCheckFailed = vi.fn();

    await handleHealthCheckJob(
      {
        runHealthChecks,
        notifyHealthCheckFailed,
        checkDebounce: vi.fn().mockResolvedValue(true),
        logger: makeLogger(),
      },
      { name: "health-check", id: "job-1", data: { triggeredBy: "scheduled" } },
    );

    expect(notifyHealthCheckFailed).not.toHaveBeenCalled();
  });

  it("does not debounce manual triggers", async () => {
    const report: HealthCheckReport = {
      results: [healthyResult, failedResult],
      totalDurationMs: 20,
      healthyCount: 1,
      failedCount: 1,
      skippedCount: 0,
    };
    const runHealthChecks = vi.fn().mockResolvedValue(report);
    const notifyHealthCheckFailed = vi.fn();
    const checkDebounce = vi.fn();

    await handleHealthCheckJob(
      {
        runHealthChecks,
        notifyHealthCheckFailed,
        checkDebounce,
        logger: makeLogger(),
      },
      { name: "health-check", id: "job-2", data: { triggeredBy: "manual" } },
    );

    expect(checkDebounce).not.toHaveBeenCalled();
    expect(notifyHealthCheckFailed).toHaveBeenCalledOnce();
  });

  it("passes collectorType when specified", async () => {
    const runHealthChecks = vi.fn().mockResolvedValue({
      results: [healthyResult],
      totalDurationMs: 5,
      healthyCount: 1,
      failedCount: 0,
      skippedCount: 0,
    });

    await handleHealthCheckJob(
      {
        runHealthChecks,
        notifyHealthCheckFailed: vi.fn(),
        checkDebounce: vi.fn(),
        logger: makeLogger(),
      },
      { name: "health-check", id: "job-3", data: { collectorType: "hn", triggeredBy: "manual" } },
    );

    expect(runHealthChecks).toHaveBeenCalledWith(
      expect.objectContaining({ collectorType: "hn" }),
    );
  });
});
