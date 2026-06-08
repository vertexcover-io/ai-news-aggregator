import { describe, it, expect } from "vitest";
import { evaluateRunHealth } from "../../../src/alerting/run-health.js";
import type { RunHealthInput } from "../../../src/alerting/run-health.js";

const baseInput: RunHealthInput = {
  enrichmentTelemetry: null,
  sourceTelemetry: null,
  publishResults: undefined,
  isDryRun: false,
};

describe("evaluateRunHealth", () => {
  it("test_EDGE_005_dry_run_suppresses_degradation: isDryRun returns empty array", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      isDryRun: true,
      enrichmentTelemetry: { attempted: 10, ok: 3, failed: 7 },
    });
    expect(result).toHaveLength(0);
  });

  it("test_EDGE_004_null_telemetry_no_false_incident: null enrichmentTelemetry produces no incidents", () => {
    const result = evaluateRunHealth({ ...baseInput, enrichmentTelemetry: null });
    expect(result).toHaveLength(0);
  });

  it("test_REQ_006_high_enrichment_failure_rate_degraded: failure rate > threshold yields warning run_degraded", () => {
    // 7/10 = 70% > 30% threshold
    const result = evaluateRunHealth({
      ...baseInput,
      enrichmentTelemetry: { attempted: 10, ok: 3, failed: 7 },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      severity: "warning",
      category: "run_degraded",
    });
  });

  it("enrichment at exactly threshold (30%) does NOT produce incident", () => {
    // 3/10 = 30% — not strictly greater
    const result = evaluateRunHealth({
      ...baseInput,
      enrichmentTelemetry: { attempted: 10, ok: 7, failed: 3 },
    });
    expect(result).toHaveLength(0);
  });

  it("enrichment with attempted=0 skips the rule", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      enrichmentTelemetry: { attempted: 0, ok: 0, failed: 0 },
    });
    expect(result).toHaveLength(0);
  });

  it("test_REQ_007_zero_yield_source_degraded: zero-yield source with historical items yields warning", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      sourceTelemetry: {
        "hn": { collected: 0, hasHistoricalItems: true },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      severity: "warning",
      category: "run_degraded",
      context: expect.objectContaining({ reason: "zero_yield", source: "hn" }),
    });
  });

  it("zero-yield source WITHOUT historical items does not trigger warning", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      sourceTelemetry: {
        "hn": { collected: 0, hasHistoricalItems: false },
      },
    });
    expect(result).toHaveLength(0);
  });

  it("source with items collected does not trigger zero-yield", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      sourceTelemetry: {
        "hn": { collected: 5, hasHistoricalItems: true },
      },
    });
    expect(result).toHaveLength(0);
  });

  it("null sourceTelemetry skips zero-yield rule", () => {
    const result = evaluateRunHealth({ ...baseInput, sourceTelemetry: null });
    expect(result).toHaveLength(0);
  });

  it("test_REQ_008_partial_publish_records_error: partial publish (some ok, some failed) yields error", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      publishResults: [
        { channel: "email-send", ok: true },
        { channel: "linkedin-post", ok: false },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      severity: "error",
      category: "publish_partial_failure",
    });
  });

  it("all publish channels succeed: no incident", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      publishResults: [
        { channel: "email-send", ok: true },
        { channel: "linkedin-post", ok: true },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it("all publish channels fail: no partial incident (all fail is a different event)", () => {
    const result = evaluateRunHealth({
      ...baseInput,
      publishResults: [
        { channel: "email-send", ok: false },
        { channel: "linkedin-post", ok: false },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it("no publishResults: no publish incident", () => {
    const result = evaluateRunHealth({ ...baseInput, publishResults: undefined });
    expect(result).toHaveLength(0);
  });
});
