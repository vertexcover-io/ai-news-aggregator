/**
 * Unit tests for buildPreReviewSnapshot pure helper.
 * REQ-001: snapshot shape, capturedAt, rankedItemIds, recap, digestMeta
 * Phase 2 of record-review-edits-as-signals.
 */
import { describe, it, expect } from "vitest";
import type { RankedItemRef } from "@newsletter/shared/types";

// Helper to build a minimal RankedItemRef fixture (as produced by the ranker)
function makeRef(
  rawItemId: number,
  overrides?: Partial<RankedItemRef>,
): RankedItemRef {
  return {
    rawItemId,
    score: 0.9,
    rationale: "good",
    title: `Recap title ${rawItemId}`,
    summary: `Summary ${rawItemId}`,
    bullets: [`Bullet ${rawItemId}a`, `Bullet ${rawItemId}b`],
    bottomLine: `Bottom line ${rawItemId}`,
    ...overrides,
  };
}

describe("buildPreReviewSnapshot", () => {
  // RED: import will fail until file is created
  const importHelper = () =>
    import("@pipeline/services/build-pre-review-snapshot.js");

  // REQ-001: snapshot contains capturedAt as valid ISO timestamp
  it("produces a capturedAt ISO timestamp (REQ-001)", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const fixedDate = new Date("2026-05-28T10:00:00.000Z");
    const snapshot = buildPreReviewSnapshot({
      rankedItems: [makeRef(1)],
      digestHeadline: "Today's AI",
      digestSummary: "Summary text",
      hook: null,
      twitterSummary: null,
      now: () => fixedDate,
    });
    expect(snapshot.capturedAt).toBe("2026-05-28T10:00:00.000Z");
  });

  // REQ-001: rankedItemIds matches input order
  it("rankedItemIds matches input order (REQ-001)", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const items = [makeRef(5), makeRef(2), makeRef(8)];
    const snapshot = buildPreReviewSnapshot({
      rankedItems: items,
      digestHeadline: null,
      digestSummary: null,
      hook: null,
      twitterSummary: null,
    });
    expect(snapshot.rankedItemIds).toEqual([5, 2, 8]);
  });

  // REQ-001: recap is keyed by rawItemId with correct fields from top-level RankedItemRef fields
  it("recap is keyed by rawItemId with title/summary/bullets/bottomLine from RankedItemRef (REQ-001)", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const item = makeRef(42, {
      title: "Curated title",
      summary: "Curated summary",
      bullets: ["Point A", "Point B"],
      bottomLine: "Key takeaway",
    });
    const snapshot = buildPreReviewSnapshot({
      rankedItems: [item],
      digestHeadline: null,
      digestSummary: null,
      hook: null,
      twitterSummary: null,
    });
    expect(snapshot.recap[42]).toEqual({
      title: "Curated title",
      summary: "Curated summary",
      bullets: ["Point A", "Point B"],
      bottomLine: "Key takeaway",
    });
  });

  // REQ-001: digestMeta carries all four fields verbatim including nulls
  it("digestMeta carries all four fields verbatim including nulls (REQ-001)", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const snapshot = buildPreReviewSnapshot({
      rankedItems: [],
      digestHeadline: "Great Headline",
      digestSummary: null,
      hook: "Read this",
      twitterSummary: "Short tweet",
    });
    expect(snapshot.digestMeta).toEqual({
      headline: "Great Headline",
      summary: null,
      hook: "Read this",
      twitterSummary: "Short tweet",
    });
  });

  // EDGE: empty ranked list → empty rankedItemIds and recap
  it("empty ranked list produces empty rankedItemIds and recap", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const snapshot = buildPreReviewSnapshot({
      rankedItems: [],
      digestHeadline: null,
      digestSummary: null,
      hook: null,
      twitterSummary: null,
    });
    expect(snapshot.rankedItemIds).toEqual([]);
    expect(snapshot.recap).toEqual({});
  });

  // EDGE: item with undefined recap fields → falls back to empty strings / arrays
  it("item with undefined recap fields uses empty string/array fallbacks", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const item = makeRef(99, {
      title: undefined,
      summary: undefined,
      bullets: undefined,
      bottomLine: undefined,
    });
    const snapshot = buildPreReviewSnapshot({
      rankedItems: [item],
      digestHeadline: null,
      digestSummary: null,
      hook: null,
      twitterSummary: null,
    });
    expect(snapshot.recap[99]).toEqual({
      title: "",
      summary: "",
      bullets: [],
      bottomLine: "",
    });
  });

  // REQ-001: multiple items produce correct order and recap entries
  it("multiple items produce correct recap entries for each (REQ-001)", async () => {
    const { buildPreReviewSnapshot } = await importHelper();
    const items = [makeRef(10), makeRef(20)];
    const snapshot = buildPreReviewSnapshot({
      rankedItems: items,
      digestHeadline: "Digest",
      digestSummary: "Summary",
      hook: null,
      twitterSummary: "tweet",
    });
    expect(snapshot.rankedItemIds).toEqual([10, 20]);
    expect(snapshot.recap[10]).toBeDefined();
    expect(snapshot.recap[20]).toBeDefined();
    expect(snapshot.recap[10]?.title).toBe("Recap title 10");
    expect(snapshot.recap[20]?.title).toBe("Recap title 20");
  });
});
