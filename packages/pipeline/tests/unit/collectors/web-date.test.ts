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

type Expectation =
  | { kind: "null" }
  | { kind: "relativeHours"; hours: number }
  | { kind: "relativeDays"; days: number }
  | { kind: "calendar"; year: number; month: number; date: number }
  | { kind: "iso"; iso: string };

interface ResolveCase {
  label: string;
  input: string | null | undefined;
  expected: Expectation;
}

describe("resolvePublishedDate — REQ-006", () => {
  // Relative, natural-language-absolute, ISO, and garbage inputs all flow
  // through the same resolver. EDGE-004/EDGE-005 (garbage/empty/null/undefined)
  // → null; EDGE-009 date-only strings anchor to local ToD so calendar cases
  // assert the calendar date only.
  const cases: ResolveCase[] = [
    { label: '"4 hours ago" → ref − 4h', input: "4 hours ago", expected: { kind: "relativeHours", hours: 4 } },
    { label: '"2 days ago" → ref − 2d', input: "2 days ago", expected: { kind: "relativeDays", days: 2 } },
    { label: '"yesterday" → one day before ref', input: "yesterday", expected: { kind: "relativeDays", days: 1 } },
    { label: '"May 25, 2026" → 2026-05-25 (EDGE-009)', input: "May 25, 2026", expected: { kind: "calendar", year: 2026, month: 4, date: 25 } },
    { label: '"25 May 2026" → 2026-05-25', input: "25 May 2026", expected: { kind: "calendar", year: 2026, month: 4, date: 25 } },
    { label: "ISO string round-trips exactly via Date.parse fallback", input: "2026-05-25T09:00:00.000Z", expected: { kind: "iso", iso: "2026-05-25T09:00:00.000Z" } },
    { label: "garbage string → null", input: "not a date at all xyz", expected: { kind: "null" } },
    { label: "empty string → null", input: "", expected: { kind: "null" } },
    { label: "null input → null", input: null, expected: { kind: "null" } },
    { label: "undefined input → null", input: undefined, expected: { kind: "null" } },
  ];

  it.each(cases)("resolves $label", ({ input, expected }) => {
    const raw = resolvePublishedDate(input, REF);

    if (expected.kind === "null") {
      expect(raw).toBeNull();
      return;
    }

    const result = expectDate(raw);
    switch (expected.kind) {
      case "relativeHours": {
        const diffHours = (REF.getTime() - result.getTime()) / (1000 * 60 * 60);
        expect(diffHours).toBeCloseTo(expected.hours, 0);
        break;
      }
      case "relativeDays": {
        const diffDays = (REF.getTime() - result.getTime()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeCloseTo(expected.days, 0);
        break;
      }
      case "calendar": {
        expect(result.getFullYear()).toBe(expected.year);
        expect(result.getMonth()).toBe(expected.month);
        expect(result.getDate()).toBe(expected.date);
        break;
      }
      case "iso": {
        expect(result.toISOString()).toBe(expected.iso);
        break;
      }
    }
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
