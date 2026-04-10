import { describe, it, expect } from "vitest";
import {
  DEFAULT_HALF_LIFE_HOURS,
  DEFAULT_GRAVITY_EXPONENT,
  recencyDecay,
  recencyGravity,
  ageHoursFromPublishedAt,
} from "@pipeline/services/recency.js";

describe("recencyDecay (REQ-030, REQ-031)", () => {
  it("returns 1 when ageHours is 0", () => {
    expect(recencyDecay(0, 48)).toBe(1);
  });

  it("returns exp(-1) when ageHours equals halfLifeHours", () => {
    expect(recencyDecay(48, 48)).toBeCloseTo(Math.exp(-1), 9);
  });

  it("returns exp(-2) when ageHours is twice halfLifeHours", () => {
    expect(recencyDecay(96, 48)).toBeCloseTo(Math.exp(-2), 9);
  });

  it("throws when halfLifeHours is zero", () => {
    expect(() => recencyDecay(1, 0)).toThrow();
  });

  it("throws when halfLifeHours is negative", () => {
    expect(() => recencyDecay(1, -1)).toThrow();
  });
});

describe("ageHoursFromPublishedAt (REQ-026)", () => {
  it("returns 24 when publishedAt is null (REQ-026 anchor)", () => {
    expect(ageHoursFromPublishedAt(null)).toBe(24);
  });

  it("returns 1 for a date one hour before now", () => {
    const now = new Date("2026-04-09T12:00:00Z");
    const oneHourAgo = new Date(now.getTime() - 3_600_000);
    expect(ageHoursFromPublishedAt(oneHourAgo, now)).toBe(1);
  });

  it("clamps future dates to 0 (does not return a negative number)", () => {
    const now = new Date("2026-04-09T12:00:00Z");
    const future = new Date(now.getTime() + 3_600_000);
    expect(ageHoursFromPublishedAt(future, now)).toBe(0);
  });
});

describe("DEFAULT_HALF_LIFE_HOURS", () => {
  it("is 48", () => {
    expect(DEFAULT_HALF_LIFE_HOURS).toBe(48);
  });
});

describe("recencyGravity (REQ-010)", () => {
  it("REQ-010: ageHours=0 returns ≈ 0.354 (1/2^1.5)", () => {
    expect(recencyGravity(0)).toBeCloseTo(0.354, 2);
  });

  it("REQ-010: ageHours=24 returns ≈ 0.00754 (1/26^1.5)", () => {
    expect(recencyGravity(24)).toBeCloseTo(0.00754, 4);
  });

  it("REQ-010: ageHours=72 returns ≈ 0.00157 (1/74^1.5)", () => {
    expect(recencyGravity(72)).toBeCloseTo(0.00157, 4);
  });

  it("REQ-010: custom exponent=2.0 applies correctly", () => {
    // 1 / (0 + 2)^2 = 1/4 = 0.25
    expect(recencyGravity(0, 2.0)).toBeCloseTo(0.25, 9);
  });

  it("REQ-010: very large ageHours produces value approaching 0 (not negative)", () => {
    const result = recencyGravity(100_000);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.0001);
  });

  it("EDGE-004: recencyGravity with 720-hour age (30 days) approaches 0", () => {
    const result = recencyGravity(720);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.0001);
  });

  it("EDGE-005: negative ageHours (future-dated item) is clamped to 0", () => {
    // clamped to 0 so result equals recencyGravity(0)
    expect(recencyGravity(-5)).toBeCloseTo(recencyGravity(0), 9);
  });
});

describe("DEFAULT_GRAVITY_EXPONENT", () => {
  it("is 1.5", () => {
    expect(DEFAULT_GRAVITY_EXPONENT).toBe(1.5);
  });
});
