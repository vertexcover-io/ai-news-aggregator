import { describe, it, expect } from "vitest";
import {
  serializeArchiveSearchText,
  type ArchiveSearchRawItem,
} from "@shared/services/archive-search-text.js";
import type { RankedItemRef } from "@shared/types/run.js";

function makeRaw(overrides: Partial<ArchiveSearchRawItem> = {}): ArchiveSearchRawItem {
  return {
    id: 1,
    title: "Default Title",
    url: "https://news.ycombinator.com/item?id=1",
    sourceType: "hn",
    author: null,
    metadata: { comments: [] },
    ...overrides,
  };
}

describe("serializeArchiveSearchText", () => {
  it("returns empty string when both digest fields null and rankedItems empty", () => {
    const out = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [],
      rawItemsById: new Map(),
    });
    expect(out).toBe("");
  });

  it("returns digest text only when rankedItems empty", () => {
    const out = serializeArchiveSearchText({
      digestHeadline: "Today's headline",
      digestSummary: "A summary of the day",
      rankedItems: [],
      rawItemsById: new Map(),
    });
    expect(out).toContain("Today's headline");
    expect(out).toContain("A summary of the day");
  });

  it("tolerates null digest fields (pre-VER-96 archives)", () => {
    const ref: RankedItemRef = { rawItemId: 1, score: 1, rationale: "r" };
    const raw = makeRaw({ id: 1, title: "Story One" });
    const out = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [ref],
      rawItemsById: new Map([[1, raw]]),
    });
    expect(out).toContain("Story One");
    expect(out).not.toContain("null");
  });

  it("RankedItemRef.summary overrides recap.summary", () => {
    const ref: RankedItemRef = {
      rawItemId: 1,
      score: 1,
      rationale: "r",
      summary: "OVERRIDE",
    };
    const raw = makeRaw({
      id: 1,
      metadata: {
        comments: [],
        recap: { summary: "ORIGINAL", bullets: [], bottomLine: "" },
      },
    });
    const out = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [ref],
      rawItemsById: new Map([[1, raw]]),
    });
    expect(out).toContain("OVERRIDE");
    expect(out).not.toContain("ORIGINAL");
  });

  it("joins bullets with newline; missing bullets render as nothing", () => {
    const refWithBullets: RankedItemRef = {
      rawItemId: 1,
      score: 1,
      rationale: "r",
      bullets: ["alpha", "beta", "gamma"],
    };
    const raw1 = makeRaw({ id: 1, title: "T1" });
    const out = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [refWithBullets],
      rawItemsById: new Map([[1, raw1]]),
    });
    expect(out).toContain("alpha\nbeta\ngamma");

    const refNoBullets: RankedItemRef = { rawItemId: 2, score: 1, rationale: "r" };
    const raw2 = makeRaw({ id: 2, title: "T2" });
    const out2 = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [refNoBullets],
      rawItemsById: new Map([[2, raw2]]),
    });
    expect(out2).toContain("T2");
    expect(out2).not.toContain("undefined");
  });

  it("includes per-story fields: title, url-host, sourceType, author, summary, bullets, bottomLine", () => {
    const ref: RankedItemRef = {
      rawItemId: 1,
      score: 1,
      rationale: "r",
      summary: "the summary text",
      bullets: ["bullet-one", "bullet-two"],
      bottomLine: "the bottom line",
    };
    const raw = makeRaw({
      id: 1,
      title: "An Important Story",
      url: "https://news.ycombinator.com/item?id=42",
      sourceType: "hn",
      author: "pg",
    });
    const out = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [ref],
      rawItemsById: new Map([[1, raw]]),
    });
    expect(out).toContain("An Important Story");
    expect(out).toContain("news.ycombinator.com");
    expect(out).toContain("hn");
    expect(out).toContain("pg");
    expect(out).toContain("the summary text");
    expect(out).toContain("bullet-one\nbullet-two");
    expect(out).toContain("the bottom line");
  });

  it("silently skips stories whose rawItemsById lookup misses", () => {
    const refHit: RankedItemRef = { rawItemId: 1, score: 1, rationale: "r" };
    const refMiss: RankedItemRef = { rawItemId: 999, score: 1, rationale: "r" };
    const raw = makeRaw({ id: 1, title: "Present Story" });
    const out = serializeArchiveSearchText({
      digestHeadline: null,
      digestSummary: null,
      rankedItems: [refHit, refMiss],
      rawItemsById: new Map([[1, raw]]),
    });
    expect(out).toContain("Present Story");
    expect(out).not.toContain("999");
  });

  it("truncates output to <= 64 KB without throwing on huge inputs", () => {
    const giantBottomLine = "x".repeat(100 * 1024); // 100 KB
    const ref: RankedItemRef = {
      rawItemId: 1,
      score: 1,
      rationale: "r",
      bottomLine: giantBottomLine,
    };
    const raw = makeRaw({ id: 1, title: "Big" });
    const out = serializeArchiveSearchText({
      digestHeadline: "h",
      digestSummary: "s",
      rankedItems: [ref],
      rawItemsById: new Map([[1, raw]]),
    });
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(64 * 1024);
  });
});
