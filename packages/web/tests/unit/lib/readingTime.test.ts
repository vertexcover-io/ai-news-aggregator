import { describe, expect, it } from "vitest";
import type { RankedItem, RecapContent } from "@newsletter/shared";
import { readingTimeMinutes } from "../../../src/lib/readingTime";

const recap = (over: Partial<RecapContent>): RecapContent => ({
  title: "t",
  summary: "",
  bullets: [],
  bottomLine: "",
  ...over,
});

const mk = (over: Partial<RankedItem> = {}): RankedItem => ({
  id: 0,
  rawItemId: 0,
  title: "t",
  url: "u",
  sourceType: "hn",
  author: null,
  publishedAt: null,
  engagement: { points: 0, commentCount: 0 },
  score: 0,
  rationale: "",
  content: null,
  imageUrl: null,
  recap: null,
  ...over,
});

describe("readingTimeMinutes", () => {
  it("returns at least 1 for an empty list", () => {
    expect(readingTimeMinutes([])).toBe(1);
  });

  it("returns at least 1 for a single short item", () => {
    expect(
      readingTimeMinutes([mk({ recap: recap({ summary: "tiny" }) })]),
    ).toBe(1);
  });

  it("counts words in summary + bullets + bottomLine across items at 200 wpm", () => {
    const longSummary = Array.from({ length: 200 }).fill("word").join(" ");
    const longBottom = Array.from({ length: 200 }).fill("word").join(" ");
    const items = [
      mk({ recap: recap({ summary: longSummary }) }),
      mk({ recap: recap({ bottomLine: longBottom }) }),
    ];
    // 400 words / 200 wpm = 2 minutes
    expect(readingTimeMinutes(items)).toBe(2);
  });

  it("includes bullet words", () => {
    const bullets = [
      Array.from({ length: 100 }).fill("word").join(" "),
      Array.from({ length: 100 }).fill("word").join(" "),
    ];
    const items = [mk({ recap: recap({ bullets }) })];
    expect(readingTimeMinutes(items)).toBe(1);
  });

  it("rounds up partial minutes (250 words → 2 min)", () => {
    const text = Array.from({ length: 250 }).fill("word").join(" ");
    const items = [mk({ recap: recap({ summary: text }) })];
    expect(readingTimeMinutes(items)).toBe(2);
  });

  it("ignores items with no recap", () => {
    const items = [mk({ recap: null }), mk({ recap: null })];
    expect(readingTimeMinutes(items)).toBe(1);
  });
});
