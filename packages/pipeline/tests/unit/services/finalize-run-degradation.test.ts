/**
 * Tests for REQ-011: finalizeRun emits pipeline_run_degraded events via emitRunHealthEvents helper.
 * Also covers REQ-012 / EDGE-006 (null telemetry → zero events).
 */

import { describe, it, expect, vi } from "vitest";
import { emitRunHealthEvents } from "@pipeline/services/finalize-run.js";

// Minimal pino-shaped logger spy
function makeLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Parameters<typeof emitRunHealthEvents>[2];
}

describe("test_REQ_011_finalize_run_emits_degraded_events", () => {
  it("emits exactly N events when evaluateRunHealth returns N findings", () => {
    const capturespy = vi.fn();
    const logger = makeLogger();

    // Telemetry that yields 1 enrichment_failure_rate finding (40% > 30% threshold)
    emitRunHealthEvents(
      {
        runId: "run-abc",
        enrichment: { ok: 6, failed: 4 }, // 4/10 = 40% > 30%
        sources: [],
        publish: null,
        isDryRun: false,
      },
      capturespy,
      logger,
    );

    expect(capturespy).toHaveBeenCalledTimes(1);
    expect(capturespy).toHaveBeenCalledWith("pipeline_run_degraded", {
      runId: "run-abc",
      kind: "enrichment_failure_rate",
      severity: "warning",
      failed: 4,
      total: 10,
      rate: 0.4,
    });
  });

  it("emits 0 events when telemetry is null/empty (EDGE-006 / REQ-012 call-site)", () => {
    const capturespy = vi.fn();
    const logger = makeLogger();

    // Null enrichment + null sources → no findings
    emitRunHealthEvents(
      {
        runId: "run-xyz",
        enrichment: null,
        sources: null,
        publish: null,
        isDryRun: false,
      },
      capturespy,
      logger,
    );

    expect(capturespy).not.toHaveBeenCalled();
  });

  it("emits 0 events for a dry run regardless of telemetry", () => {
    const capturespy = vi.fn();
    const logger = makeLogger();

    emitRunHealthEvents(
      {
        runId: "run-dry",
        enrichment: { ok: 0, failed: 10 }, // would trigger if not dry
        sources: null,
        publish: null,
        isDryRun: true,
      },
      capturespy,
      logger,
    );

    expect(capturespy).not.toHaveBeenCalled();
  });

  it("each emitted event carries runId, kind, and severity", () => {
    const capturespy = vi.fn();
    const logger = makeLogger();

    // Craft telemetry that yields 2 findings:
    // 1) enrichment_failure_rate (50% > 30%)
    // 2) zero_yield_source (historicalYield: true + collected: 0)
    emitRunHealthEvents(
      {
        runId: "run-multi",
        enrichment: { ok: 5, failed: 5 }, // 50% > 30%
        sources: [
          { source: "reddit", collected: 0, historicalYield: true },
        ],
        publish: null,
        isDryRun: false,
      },
      capturespy,
      logger,
    );

    expect(capturespy).toHaveBeenCalledTimes(2);
    for (const call of capturespy.mock.calls) {
      const [eventName, props] = call as [string, Record<string, unknown>];
      expect(eventName).toBe("pipeline_run_degraded");
      expect(props).toHaveProperty("runId", "run-multi");
      expect(props).toHaveProperty("kind");
      expect(props).toHaveProperty("severity");
    }
  });

  it("swallows errors from capturePipelineEvent and logs a warn without throwing", () => {
    const capturespy = vi.fn(() => {
      throw new Error("posthog transport down");
    });
    const logger = makeLogger();

    // Should not throw
    expect(() =>
      emitRunHealthEvents(
        {
          runId: "run-err",
          enrichment: { ok: 6, failed: 4 }, // triggers a finding
          sources: null,
          publish: null,
          isDryRun: false,
        },
        capturespy,
        logger,
      ),
    ).not.toThrow();

    expect(logger.warn).toHaveBeenCalled();
  });
});
