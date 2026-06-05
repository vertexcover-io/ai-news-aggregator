import { describe, it, expect } from "vitest";
import {
  recencyDecay,
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
