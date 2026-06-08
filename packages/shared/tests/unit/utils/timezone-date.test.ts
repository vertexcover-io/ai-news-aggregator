import { describe, expect, it } from "vitest";

import {
  endOfDateInTimezone,
  formatDateInTimezone,
  formatDateTimeInTimezone,
  safeTimezone,
  startOfDateInTimezone,
} from "@shared/utils/timezone-date.js";

describe("timezone date utilities", () => {
  it("REQ-001 EDGE-003: formats a near-midnight UTC instant in the configured timezone", () => {
    const instant = new Date("2026-05-22T19:47:55.923Z");

    expect(formatDateInTimezone(instant, "Asia/Kolkata")).toBe("2026-05-23");
  });

  it("REQ-002 EDGE-002: falls back to UTC for invalid timezone names", () => {
    const instant = new Date("2026-05-22T19:47:55.923Z");

    expect(safeTimezone("Nope/BadZone")).toBe("UTC");
    expect(formatDateInTimezone(instant, "Nope/BadZone")).toBe("2026-05-22");
  });

  it("REQ-009: formats date-time labels in the configured timezone", () => {
    const instant = new Date("2026-05-22T19:47:55.923Z");

    expect(formatDateTimeInTimezone(instant, "Asia/Kolkata")).toContain("May 23");
  });
});

describe("startOfDateInTimezone", () => {
  it("returns midnight of the given date in the target timezone as a UTC Date", () => {
    // Asia/Kolkata is UTC+5:30, so midnight 2026-05-23 IST = 2026-05-22T18:30:00.000Z
    const result = startOfDateInTimezone("2026-05-23", "Asia/Kolkata");

    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-05-22T18:30:00.000Z");
  });

  it("returns midnight in UTC when timezone is UTC", () => {
    const result = startOfDateInTimezone("2026-06-01", "UTC");

    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns null for a string that is not an ISO date", () => {
    expect(startOfDateInTimezone("not-a-date", "UTC")).toBeNull();
  });

  it("returns a Date instance for a valid date", () => {
    const result = startOfDateInTimezone("2026-01-01", "America/New_York");

    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result?.getTime())).toBe(false);
  });
});

describe("endOfDateInTimezone", () => {
  it("returns the last millisecond of the given date in the target timezone", () => {
    // 2026-05-23 IST starts at 2026-05-22T18:30:00.000Z
    // 2026-05-24 IST starts at 2026-05-23T18:30:00.000Z
    // So end of 2026-05-23 IST = 2026-05-23T18:29:59.999Z
    const result = endOfDateInTimezone("2026-05-23", "Asia/Kolkata");

    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-05-23T18:29:59.999Z");
  });

  it("returns null for an invalid ISO date string", () => {
    expect(endOfDateInTimezone("not-a-date", "UTC")).toBeNull();
  });

  it("is exactly 1ms before the next day's startOfDateInTimezone", () => {
    const endOf = endOfDateInTimezone("2026-06-08", "Asia/Kolkata");
    const startOfNext = startOfDateInTimezone("2026-06-09", "Asia/Kolkata");

    expect(endOf).not.toBeNull();
    expect(startOfNext).not.toBeNull();
    if (endOf == null || startOfNext == null) throw new Error("unexpected null");
    const endOfMs: number = endOf.getTime();
    expect(endOfMs + 1).toBe(startOfNext.getTime());
  });

  it("end of 2026-06-08 UTC is 2026-06-08T23:59:59.999Z", () => {
    const result = endOfDateInTimezone("2026-06-08", "UTC");

    expect(result?.toISOString()).toBe("2026-06-08T23:59:59.999Z");
  });
});
