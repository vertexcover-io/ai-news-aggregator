import { describe, expect, it, vi, afterEach } from "vitest";
import {
  addDaysToIsoDate,
  configuredTimezone,
  todayInTimezone,
} from "../../../src/lib/dateSelectorTimezone";

afterEach(() => {
  vi.useRealTimers();
});

describe("dateSelectorTimezone", () => {
  it("uses the configured timezone for today's date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T19:00:00.000Z"));

    expect(todayInTimezone("Asia/Kolkata")).toBe("2026-05-23");
  });

  it("falls back to UTC for invalid timezones", () => {
    expect(configuredTimezone("Mars/Base")).toBe("UTC");
  });

  it("shifts date-only values by calendar days", () => {
    expect(addDaysToIsoDate("2026-05-23", -30)).toBe("2026-04-23");
  });
});
