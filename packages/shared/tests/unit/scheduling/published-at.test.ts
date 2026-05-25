import { describe, expect, it } from "vitest";
import { resolveScheduledPublishAt } from "@shared/scheduling/published-at.js";

function localParts(tz: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return formatter.format(date);
}

describe("resolveScheduledPublishAt", () => {
  // REQ-002, EDGE-002: late-night run (NY-local 23:30) with earlier publish time
  // -> next day 06:00 NY (publishMinutes < pipelineMinutes adds a local day).
  it("schedules an earlier emailTime on the next local day for a late-night run", () => {
    const result = resolveScheduledPublishAt({
      scheduleTimezone: "America/New_York",
      pipelineTime: "23:00",
      emailTime: "06:00",
      completedAt: new Date("2026-05-19T03:30:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(localParts("America/New_York", result as Date)).toBe("2026-05-19, 06:00");
  });

  // EDGE-002: completedAt NY-local 03:00 with same times -> still next-day 06:00.
  it("adds a local day when publishMinutes < pipelineMinutes for an early-morning run", () => {
    const result = resolveScheduledPublishAt({
      scheduleTimezone: "America/New_York",
      pipelineTime: "23:00",
      emailTime: "06:00",
      completedAt: new Date("2026-05-18T07:00:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(localParts("America/New_York", result as Date)).toBe("2026-05-19, 06:00");
  });

  // REQ-004, EDGE-001: emailTime === pipelineTime -> null, no throw.
  it("returns null without throwing when emailTime equals pipelineTime", () => {
    expect(() =>
      resolveScheduledPublishAt({
        scheduleTimezone: "America/New_York",
        pipelineTime: "06:00",
        emailTime: "06:00",
        completedAt: new Date("2026-05-19T03:30:00.000Z"),
      }),
    ).not.toThrow();

    const result = resolveScheduledPublishAt({
      scheduleTimezone: "America/New_York",
      pipelineTime: "06:00",
      emailTime: "06:00",
      completedAt: new Date("2026-05-19T03:30:00.000Z"),
    });
    expect(result).toBeNull();
  });

  // EDGE-008: malformed emailTime -> null (helper would otherwise throw on parse).
  it("returns null when emailTime is malformed", () => {
    const result = resolveScheduledPublishAt({
      scheduleTimezone: "America/New_York",
      pipelineTime: "23:00",
      emailTime: "6am",
      completedAt: new Date("2026-05-19T03:30:00.000Z"),
    });
    expect(result).toBeNull();
  });

  // REQ-003, EDGE-004: missing inputs -> null.
  it.each([
    ["scheduleTimezone null", { scheduleTimezone: null, pipelineTime: "23:00", emailTime: "06:00" }],
    ["scheduleTimezone empty", { scheduleTimezone: "", pipelineTime: "23:00", emailTime: "06:00" }],
    ["pipelineTime null", { scheduleTimezone: "America/New_York", pipelineTime: null, emailTime: "06:00" }],
    ["pipelineTime empty", { scheduleTimezone: "America/New_York", pipelineTime: "", emailTime: "06:00" }],
    ["emailTime null", { scheduleTimezone: "America/New_York", pipelineTime: "23:00", emailTime: null }],
    ["emailTime empty", { scheduleTimezone: "America/New_York", pipelineTime: "23:00", emailTime: "" }],
  ])("returns null when %s", (_label, partial) => {
    const result = resolveScheduledPublishAt({
      ...partial,
      completedAt: new Date("2026-05-19T03:30:00.000Z"),
    });
    expect(result).toBeNull();
  });
});
