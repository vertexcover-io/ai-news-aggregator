import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDuration,
  formatElapsed,
} from "../../../../src/components/observability/format";

describe("observability format helpers", () => {
  it("formatDuration renders ms, seconds, and mm:ss", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(38200)).toBe("38.2s");
    expect(formatDuration(108000)).toBe("1:48");
  });

  it("formatCount renders thousands separators and '—' for null", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(1284)).toBe("1,284");
  });

  it("formatElapsed returns mm:ss between two timestamps", () => {
    expect(
      formatElapsed("2026-05-25T09:00:00Z", "2026-05-25T09:01:48Z"),
    ).toBe("01:48");
    expect(formatElapsed(null, null)).toBe("—");
  });
});
