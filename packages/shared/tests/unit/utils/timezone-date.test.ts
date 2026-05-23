import { describe, expect, it } from "vitest";

import {
  formatDateInTimezone,
  formatDateTimeInTimezone,
  safeTimezone,
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
