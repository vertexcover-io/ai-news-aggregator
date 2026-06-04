import { describe, it, expect } from "vitest";
import type { RunSummary } from "@newsletter/shared";
import { deriveStatus, formatStartedAt, formatIssueDate, canViewSources } from "../../../../src/components/dashboard/run-status";

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    runId: "r-1",
    startedAt: "2026-04-14T00:00:00Z",
    completedAt: "2026-04-14T00:01:00Z",
    status: "completed",
    itemCount: 10,
    reviewed: false,
    isDryRun: false,
    costBreakdown: null,
    ...overrides,
  };
}

describe("deriveStatus", () => {
  it("returns running for status=running", () => {
    expect(deriveStatus(makeRun({ status: "running" }))).toBe("running");
  });

  it("returns cancelling for status=cancelling", () => {
    expect(deriveStatus(makeRun({ status: "cancelling" }))).toBe("cancelling");
  });

  it("returns cancelled for status=cancelled", () => {
    expect(deriveStatus(makeRun({ status: "cancelled" }))).toBe("cancelled");
  });

  it("returns failed for status=failed", () => {
    expect(deriveStatus(makeRun({ status: "failed" }))).toBe("failed");
  });

  it("returns reviewed when status=completed and reviewed=true", () => {
    expect(deriveStatus(makeRun({ status: "completed", reviewed: true }))).toBe("reviewed");
  });

  it("returns ready-to-review when status=completed and reviewed=false", () => {
    expect(deriveStatus(makeRun({ status: "completed", reviewed: false }))).toBe("ready-to-review");
  });
});

describe("formatStartedAt", () => {
  it("returns formatted date and time for a valid ISO string", () => {
    const result = formatStartedAt("2026-04-14T12:30:00Z");
    expect(result.date).toBeTruthy();
    expect(result.time).toBeTruthy();
  });

  it("returns original value and empty time for an invalid date", () => {
    const result = formatStartedAt("not-a-date");
    expect(result.date).toBe("not-a-date");
    expect(result.time).toBe("");
  });
});

describe("formatIssueDate", () => {
  it("returns empty string for undefined", () => {
    expect(formatIssueDate(undefined)).toBe("");
  });

  it("formats a date-only string using UTC timezone", () => {
    const result = formatIssueDate("2026-05-26");
    expect(result).toContain("2026");
    expect(result).toContain("26");
  });

  it("formats an ISO datetime string", () => {
    const result = formatIssueDate("2026-05-26T00:00:00Z");
    expect(result).toContain("2026");
  });

  it("returns empty string for invalid date", () => {
    expect(formatIssueDate("bad-date")).toBe("");
  });
});

describe("canViewSources", () => {
  it("returns true for completed status", () => {
    expect(canViewSources(makeRun({ status: "completed" }))).toBe(true);
  });

  it("returns false for non-completed status", () => {
    expect(canViewSources(makeRun({ status: "running" }))).toBe(false);
    expect(canViewSources(makeRun({ status: "failed" }))).toBe(false);
  });
});
