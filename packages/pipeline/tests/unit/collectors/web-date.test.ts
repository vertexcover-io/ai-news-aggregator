import { describe, it, expect } from "vitest";
import { resolvePublishedDate } from "@pipeline/collectors/web-date.js";

// Fixed reference instant used across all relative tests — ensures determinism (EDGE-008)
const REF = new Date("2026-05-26T12:00:00.000Z");

function expectDate(value: Date | null): Date {
  if (value === null) {
    throw new Error("expected a Date, got null");
  }
  return value;
}

describe("resolvePublishedDate — REQ-006", () => {
  // --- Relative inputs ---

  it('resolves "4 hours ago" to ref − 4h', () => {
    const result = expectDate(resolvePublishedDate("4 hours ago", REF));
    const diffHours = (REF.getTime() - result.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(4, 0);
  });

  it('resolves "2 days ago" to ref − 2d', () => {
    const result = expectDate(resolvePublishedDate("2 days ago", REF));
    const diffDays = (REF.getTime() - result.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(2, 0);
  });

  it('resolves "yesterday" to a date one day before ref', () => {
    const result = expectDate(resolvePublishedDate("yesterday", REF));
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(4); // May = 4
    expect(result.getUTCDate()).toBe(25);
  });

  // --- Natural-language absolute (EDGE-009: date-only strings anchor to local ToD — assert calendar date only) ---

  it('resolves "May 25, 2026" to calendar date 2026-05-25 (EDGE-009)', () => {
    const result = expectDate(resolvePublishedDate("May 25, 2026", REF));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4); // May
    expect(result.getDate()).toBe(25);
  });

  it('resolves "25 May 2026" to calendar date 2026-05-25', () => {
    const result = expectDate(resolvePublishedDate("25 May 2026", REF));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4);
    expect(result.getDate()).toBe(25);
  });

  // --- ISO passthrough ---

  it("ISO string round-trips exactly via Date.parse fallback", () => {
    const iso = "2026-05-25T09:00:00.000Z";
    const result = expectDate(resolvePublishedDate(iso, REF));
    expect(result.toISOString()).toBe(iso);
  });

  // --- Garbage / empty inputs (EDGE-004, EDGE-005) ---

  it("returns null for garbage string", () => {
    expect(resolvePublishedDate("not a date at all xyz", REF)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolvePublishedDate("", REF)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(resolvePublishedDate(null, REF)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(resolvePublishedDate(undefined, REF)).toBeNull();
  });

  // --- Determinism (EDGE-008): two different referenceDates yield correspondingly different results ---

  it("EDGE-008: resolution is deterministic against the explicit referenceDate — no hidden Date.now()", () => {
    const ref1 = new Date("2026-05-26T12:00:00.000Z");
    const ref2 = new Date("2026-05-20T12:00:00.000Z"); // 6 days earlier

    const result1 = expectDate(resolvePublishedDate("4 hours ago", ref1));
    const result2 = expectDate(resolvePublishedDate("4 hours ago", ref2));

    // result2 should be ~6 days before result1
    const diffDays = (result1.getTime() - result2.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(6, 0);
  });

  // --- Date-only chrono anchor tolerance (EDGE-009) ---

  it("EDGE-009: date-only string without time-of-day is accepted (calendar date is the signal)", () => {
    const result = expectDate(resolvePublishedDate("2026-05-25", REF));
    // chrono or Date.parse may handle this; result is not null and has correct calendar date
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4);
    expect(result.getDate()).toBe(25);
  });
});
