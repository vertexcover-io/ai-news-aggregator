import { describe, expect, it } from "vitest";
import { formatCostUsd, formatTokens } from "../../../../src/components/dashboard/cost-format";

describe("formatCostUsd (REQ-080..REQ-082)", () => {
  it("REQ-080: formats 0.041 as $0.041 (3 decimal places)", () => {
    expect(formatCostUsd(0.041)).toBe("$0.041");
  });

  it("REQ-081: returns '?' for null", () => {
    expect(formatCostUsd(null)).toBe("?");
  });

  it("REQ-082: formats 0 as $0.000 (not '—')", () => {
    expect(formatCostUsd(0)).toBe("$0.000");
  });

  it("rounds to 3 decimals", () => {
    expect(formatCostUsd(0.6371234)).toBe("$0.637");
  });
});

describe("formatTokens (REQ-083, REQ-084)", () => {
  it("REQ-083: formats 1,234,567 as 1.2M", () => {
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });

  it("REQ-084: formats 48,210 with thousands separator", () => {
    expect(formatTokens(48_210)).toBe("48,210");
  });

  it("formats 0 as '0' (sub-thousand passthrough)", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("formats exactly 1,000,000 as 1.0M", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });
});
