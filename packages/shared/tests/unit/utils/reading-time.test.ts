import { describe, it, expect } from "vitest";
import { readingTimeMinutes } from "@shared/utils/reading-time.js";

describe("readingTimeMinutes", () => {
  it("returns 1 for an empty stories array (minimum)", () => {
    expect(readingTimeMinutes([])).toBe(1);
  });

  it("returns 1 for stories with all-null fields (minimum)", () => {
    expect(readingTimeMinutes([{ summary: null, bottomLine: null, bullets: null }])).toBe(1);
  });

  it("returns 1 for stories with all-undefined fields (minimum)", () => {
    expect(readingTimeMinutes([{}])).toBe(1);
  });

  it("returns 1 for stories with empty-string fields (minimum)", () => {
    expect(readingTimeMinutes([{ summary: "", bottomLine: "", bullets: [] }])).toBe(1);
  });

  it("counts words in summary", () => {
    // 200 words → exactly 1 minute
    const summary = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    expect(readingTimeMinutes([{ summary }])).toBe(1);
  });

  it("exceeds threshold when word count pushes above 200", () => {
    // 201 words → ceil(201/200) = 2 minutes
    const summary = Array.from({ length: 201 }, (_, i) => `word${i}`).join(" ");
    expect(readingTimeMinutes([{ summary }])).toBe(2);
  });

  it("counts words in bottomLine", () => {
    const bottomLine = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    expect(readingTimeMinutes([{ bottomLine }])).toBe(1);
  });

  it("counts words across all bullets", () => {
    // 4 bullets of 50 words each = 200 total → 1 minute
    const bullet = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    expect(readingTimeMinutes([{ bullets: [bullet, bullet, bullet, bullet] }])).toBe(1);
  });

  it("accumulates word count across multiple stories", () => {
    // Each story contributes 100 words, two stories = 200 → 1 minute
    const summary = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    expect(readingTimeMinutes([{ summary }, { summary }])).toBe(1);
  });

  it("combines summary + bottomLine + bullets for total word count", () => {
    // 100 + 100 + 1 bullet of 1 word = 201 → 2 minutes
    const hundredWords = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    expect(
      readingTimeMinutes([{ summary: hundredWords, bottomLine: hundredWords, bullets: ["extra"] }]),
    ).toBe(2);
  });

  it("returns minimum 1 even for a single-word story", () => {
    expect(readingTimeMinutes([{ summary: "hello" }])).toBe(1);
  });

  it("handles bullets: null without throwing", () => {
    expect(() => readingTimeMinutes([{ bullets: null }])).not.toThrow();
    expect(readingTimeMinutes([{ bullets: null }])).toBe(1);
  });

  it("handles bullets: [] (empty array) without throwing", () => {
    expect(() => readingTimeMinutes([{ bullets: [] }])).not.toThrow();
    expect(readingTimeMinutes([{ bullets: [] }])).toBe(1);
  });
});
