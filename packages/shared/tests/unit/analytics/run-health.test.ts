import { describe, expect, it } from "vitest";
import {
  evaluateRunHealth,
  type RunHealthInput,
} from "../../../src/analytics/run-health.js";

describe("test_REQ_010_evaluate_run_health_findings", () => {
  it("returns all three finding kinds for a crafted input", () => {
    const input: RunHealthInput = {
      enrichment: { ok: 6, failed: 4 }, // rate 0.4 > 0.3
      sources: [
        { source: "hackernews", collected: 5, historicalYield: true },
        { source: "empty-source", collected: 0, historicalYield: true }, // zero_yield_source
        { source: "new-source", collected: 0, historicalYield: false }, // no historicalYield → skip
      ],
      publish: { ok: 3, failed: 1 }, // partial_publish
      isDryRun: false,
    };
    const findings = evaluateRunHealth(input);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain("enrichment_failure_rate");
    expect(kinds).toContain("zero_yield_source");
    expect(kinds).toContain("partial_publish");

    const enrichmentFinding = findings.find(
      (f) => f.kind === "enrichment_failure_rate",
    );
    expect(enrichmentFinding?.severity).toBe("warning");
    expect(enrichmentFinding?.detail).toMatchObject({ failed: 4, total: 10 });

    const zeroYieldFinding = findings.find(
      (f) => f.kind === "zero_yield_source",
    );
    expect(zeroYieldFinding?.severity).toBe("warning");
    expect(zeroYieldFinding?.detail).toMatchObject({ source: "empty-source" });

    const partialPublish = findings.find((f) => f.kind === "partial_publish");
    expect(partialPublish?.severity).toBe("error");
    expect(partialPublish?.detail).toMatchObject({ ok: 3, failed: 1 });
  });
});

describe("test_EDGE_004_enrichment_failures_aggregate_to_finding", () => {
  it("produces exactly one enrichment_failure_rate finding regardless of count", () => {
    const input: RunHealthInput = {
      enrichment: { ok: 6, failed: 4 }, // rate 0.4 > threshold 0.3
      sources: null,
      publish: null,
      isDryRun: false,
    };
    const findings = evaluateRunHealth(input).filter(
      (f) => f.kind === "enrichment_failure_rate",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail.rate).toBeCloseTo(0.4, 5);
  });
});

describe("test_EDGE_006_null_telemetry_zero_findings", () => {
  it("returns empty array for all-null input", () => {
    const input: RunHealthInput = {
      enrichment: null,
      sources: null,
      publish: null,
      isDryRun: false,
    };
    expect(evaluateRunHealth(input)).toEqual([]);
  });

  it("returns empty array when isDryRun is true", () => {
    const input: RunHealthInput = {
      enrichment: { ok: 0, failed: 100 },
      sources: [{ source: "s", collected: 0, historicalYield: true }],
      publish: { ok: 1, failed: 1 },
      isDryRun: true,
    };
    expect(evaluateRunHealth(input)).toEqual([]);
  });
});
