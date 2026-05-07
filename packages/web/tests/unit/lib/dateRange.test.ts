import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatRangeLabel,
  presetRange,
  parseRangeFromParams,
  serializeRangeToParams,
} from "../../../src/lib/dateRange";

describe("formatRangeLabel", () => {
  it("returns ALL TIME when both undefined", () => {
    expect(formatRangeLabel(undefined, undefined)).toBe("ALL TIME");
  });

  it("formats same-year range as 'APR 8 – MAY 6, 2026'", () => {
    const from = new Date(2026, 3, 8);
    const to = new Date(2026, 4, 6);
    expect(formatRangeLabel(from, to)).toBe("APR 8 – MAY 6, 2026");
  });

  it("formats range with only from defined", () => {
    const from = new Date(2026, 3, 8);
    expect(formatRangeLabel(from, undefined)).toContain("APR 8");
  });

  it("formats cross-year range with year on both ends", () => {
    const from = new Date(2025, 11, 20);
    const to = new Date(2026, 0, 5);
    const label = formatRangeLabel(from, to);
    expect(label).toContain("DEC 20, 2025");
    expect(label).toContain("JAN 5, 2026");
  });
});

describe("presetRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 7, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns last 7 days range ending today", () => {
    const r = presetRange("last-7-days");
    if (!r?.from || !r.to) throw new Error("expected range");
    const days = Math.round((r.to.getTime() - r.from.getTime()) / (1000 * 60 * 60 * 24));
    expect(days).toBe(7);
  });

  it("returns last 30 days range", () => {
    const r = presetRange("last-30-days");
    if (!r?.from || !r.to) throw new Error("expected range");
    const days = Math.round((r.to.getTime() - r.from.getTime()) / (1000 * 60 * 60 * 24));
    expect(days).toBe(30);
  });

  it("returns last 90 days range", () => {
    const r = presetRange("last-90-days");
    if (!r?.from || !r.to) throw new Error("expected range");
    const days = Math.round((r.to.getTime() - r.from.getTime()) / (1000 * 60 * 60 * 24));
    expect(days).toBe(90);
  });

  it("returns this-year range from Jan 1 to today", () => {
    const r = presetRange("this-year");
    if (!r?.from) throw new Error("expected range");
    expect(r.from.getMonth()).toBe(0);
    expect(r.from.getDate()).toBe(1);
    expect(r.from.getFullYear()).toBe(2026);
  });

  it("all-time returns undefined sentinel", () => {
    expect(presetRange("all-time")).toBeUndefined();
  });
});

describe("parse/serialize range params", () => {
  it("parses YYYY-MM-DD strings", () => {
    const r = parseRangeFromParams({ from: "2026-04-08", to: "2026-05-06" });
    if (!r.from || !r.to) throw new Error("expected dates");
    expect(r.from).toBeInstanceOf(Date);
    expect(r.to).toBeInstanceOf(Date);
    expect(r.from.getFullYear()).toBe(2026);
    expect(r.from.getMonth()).toBe(3);
    expect(r.from.getDate()).toBe(8);
    expect(r.to.getDate()).toBe(6);
  });

  it("returns undefined for missing or empty input", () => {
    expect(parseRangeFromParams({}).from).toBeUndefined();
    expect(parseRangeFromParams({ from: "", to: "" }).from).toBeUndefined();
  });

  it("returns undefined for garbage input", () => {
    const r = parseRangeFromParams({ from: "not-a-date", to: "????" });
    expect(r.from).toBeUndefined();
    expect(r.to).toBeUndefined();
  });

  it("serialize produces YYYY-MM-DD ISO date strings", () => {
    const out = serializeRangeToParams({
      from: new Date(2026, 3, 8),
      to: new Date(2026, 4, 6),
    });
    expect(out.from).toBe("2026-04-08");
    expect(out.to).toBe("2026-05-06");
  });

  it("round-trips through parse and serialize", () => {
    const params = { from: "2026-04-08", to: "2026-05-06" };
    const parsed = parseRangeFromParams(params);
    const serialized = serializeRangeToParams(parsed);
    expect(serialized).toEqual(params);
  });

  it("serialize returns empty object for undefined range", () => {
    const out = serializeRangeToParams({ from: undefined, to: undefined });
    expect(out.from).toBeUndefined();
    expect(out.to).toBeUndefined();
  });
});
