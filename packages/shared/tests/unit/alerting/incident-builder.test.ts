import { describe, it, expect } from "vitest";
import { buildIncidentMessage } from "../../../src/slack/builders/incident.js";
import type { Incident } from "../../../src/types/incident.js";

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    fingerprint: "job_failed:my-queue:MyJob",
    severity: "error",
    category: "job_failed",
    title: "Job failed: MyJob",
    message: "Job MyJob on queue my-queue failed: ECONNREFUSED",
    source: "my-queue",
    runId: null,
    context: {},
    status: "open",
    occurrences: 1,
    deliveryAttempts: 0,
    firstSeenAt: new Date("2026-06-01T10:00:00Z"),
    lastSeenAt: new Date("2026-06-01T11:00:00Z"),
    notifiedAt: null,
    ...overrides,
  };
}

describe("buildIncidentMessage", () => {
  it("returns an object with a blocks array", () => {
    const result = buildIncidentMessage(makeIncident());
    expect(result).toHaveProperty("blocks");
    expect(Array.isArray(result.blocks)).toBe(true);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("includes severity in header block", () => {
    const result = buildIncidentMessage(makeIncident({ severity: "critical" }));
    const header = result.blocks[0] as { type: string; text: { text: string } };
    expect(header.text.text).toContain("critical");
  });

  it("includes incident title in blocks", () => {
    const result = buildIncidentMessage(makeIncident({ title: "Worker crashed" }));
    const blockTexts = JSON.stringify(result.blocks);
    expect(blockTexts).toContain("Worker crashed");
  });

  it("includes source when present", () => {
    const result = buildIncidentMessage(makeIncident({ source: "my-queue" }));
    const blockTexts = JSON.stringify(result.blocks);
    expect(blockTexts).toContain("my-queue");
  });

  it("includes occurrences count", () => {
    const result = buildIncidentMessage(makeIncident({ occurrences: 3 }));
    const blockTexts = JSON.stringify(result.blocks);
    expect(blockTexts).toContain("3");
  });

  it("includes run link when runId is set and PUBLIC_BASE_URL provided", () => {
    const result = buildIncidentMessage(
      makeIncident({ runId: "run-abc-123" }),
      "https://example.com",
    );
    const blockTexts = JSON.stringify(result.blocks);
    expect(blockTexts).toContain("run-abc-123");
    expect(blockTexts).toContain("https://example.com");
  });

  it("omits run link when runId is null", () => {
    const result = buildIncidentMessage(makeIncident({ runId: null }), "https://example.com");
    const blockTexts = JSON.stringify(result.blocks);
    expect(blockTexts).not.toContain("archive");
  });
});
