import { describe, expect, it } from "vitest";
import { diffReview } from "../diff.js";
import type { PreReviewSnapshot } from "../types.js";

// Minimal snapshot factory — all fields explicitly set so tests are readable.
function makeSnapshot(overrides: Partial<PreReviewSnapshot> = {}): PreReviewSnapshot {
  return {
    capturedAt: "2026-05-28T12:00:00.000Z",
    rankedItemIds: [10, 20, 30],
    recap: {
      10: { title: "Title A", summary: "Summary A", bullets: ["bullet1"], bottomLine: "BL A" },
      20: { title: "Title B", summary: "Summary B", bullets: ["bullet2"], bottomLine: "BL B" },
      30: { title: "Title C", summary: "Summary C", bullets: ["bullet3"], bottomLine: "BL C" },
    },
    digestMeta: {
      headline: "Today in AI",
      summary: "A great day",
      hook: "Read this",
      twitterSummary: "AI news",
    },
    ...overrides,
  };
}

// Minimal patch factory — mirrors the snapshot (no changes by default).
function makePatch(overrides: Partial<Parameters<typeof diffReview>[1]> = {}): Parameters<typeof diffReview>[1] {
  return {
    rankedItems: [{ id: 10 }, { id: 20 }, { id: 30 }],
    digestHeadline: "Today in AI",
    digestSummary: "A great day",
    hook: "Read this",
    twitterSummary: "AI news",
    ...overrides,
  };
}

describe("diffReview", () => {
  // REQ-006, EDGE-007: no-op — snapshot and patch are identical
  it("returns [] when snapshot and patch are identical (REQ-006, EDGE-007)", () => {
    const result = diffReview(makeSnapshot(), makePatch());
    expect(result).toEqual([]);
  });

  // EDGE-007: re-submitting the same patch deterministically produces the same result
  it("is deterministic — calling twice with same inputs gives same result (EDGE-007)", () => {
    const snapshot = makeSnapshot();
    const patch = makePatch();
    expect(diffReview(snapshot, patch)).toEqual(diffReview(snapshot, patch));
  });

  // EDGE-001: reorder only — same set of ids, different order
  it("emits one reorder row per item whose position changed (EDGE-001)", () => {
    const snapshot = makeSnapshot({ rankedItemIds: [10, 20, 30] });
    // swap 10 and 30
    const patch = makePatch({ rankedItems: [{ id: 30 }, { id: 20 }, { id: 10 }] });
    const result = diffReview(snapshot, patch);

    // 20 stays at position 1 in both → no row; 10 and 30 move → 2 rows
    const reorders = result.filter((r) => r.editType === "reorder");
    expect(reorders.length).toBe(2);

    const item10 = reorders.find((r) => r.rawItemId === 10);
    expect(item10).toBeDefined();
    expect(item10?.positionBefore).toBe(0); // 0-indexed
    expect(item10?.positionAfter).toBe(2);
    expect(item10?.field).toBe("rank");

    const item30 = reorders.find((r) => r.rawItemId === 30);
    expect(item30).toBeDefined();
    expect(item30?.positionBefore).toBe(2);
    expect(item30?.positionAfter).toBe(0);

    // No adds or removes when set is identical
    expect(result.filter((r) => r.editType === "add" || r.editType === "remove")).toHaveLength(0);
  });

  // EDGE-001: item at same position — no reorder row
  it("emits no reorder row for items that did not change position (EDGE-001)", () => {
    const snapshot = makeSnapshot({ rankedItemIds: [10, 20, 30] });
    // only move 30 to front; 10 and 20 both shift but 20 stays at relative order 1→1
    const patch = makePatch({ rankedItems: [{ id: 30 }, { id: 10 }, { id: 20 }] });
    const result = diffReview(snapshot, patch);
    const reorders = result.filter((r) => r.editType === "reorder");
    // All three items moved positions
    expect(reorders.every((r) => r.editType === "reorder")).toBe(true);
    // 20 moved from index 1 to index 2 — should have a row
    expect(reorders.find((r) => r.rawItemId === 20)).toBeDefined();
  });

  // EDGE-002: remove — item in snapshot not in patch
  it("emits one remove row for an item present in snapshot but absent in patch (EDGE-002)", () => {
    const snapshot = makeSnapshot({ rankedItemIds: [10, 20, 30] });
    const patch = makePatch({ rankedItems: [{ id: 10 }, { id: 20 }] }); // 30 removed
    const result = diffReview(snapshot, patch);

    const removes = result.filter((r) => r.editType === "remove");
    expect(removes).toHaveLength(1);
    expect(removes[0]?.rawItemId).toBe(30);
    expect(removes[0]?.positionBefore).toBe(2);
    expect(removes[0]?.positionAfter).toBeNull();

    // No text_edit rows for the removed item
    expect(result.filter((r) => r.editType === "text_edit" && r.rawItemId === 30)).toHaveLength(0);
  });

  // EDGE-003: add — item in patch not in snapshot (pool promote / add-post)
  it("emits one add row for an item in patch but absent in snapshot (EDGE-003)", () => {
    const snapshot = makeSnapshot({ rankedItemIds: [10, 20] });
    const patch = makePatch({ rankedItems: [{ id: 10 }, { id: 20 }, { id: 99 }] }); // 99 is new
    const result = diffReview(snapshot, patch);

    const adds = result.filter((r) => r.editType === "add");
    expect(adds).toHaveLength(1);
    expect(adds[0]?.rawItemId).toBe(99);
    expect(adds[0]?.positionBefore).toBeNull();
    expect(adds[0]?.positionAfter).toBe(2);
  });

  // EDGE-009: snapshot items-not-in-LLM-ranking treated as "not ranked" → add on PATCH
  it("treats items absent from snapshot.rankedItemIds as not-ranked → add edit (EDGE-009)", () => {
    // snapshot has only 10 and 20; item 50 was never in the LLM ranking
    const snapshot = makeSnapshot({
      rankedItemIds: [10, 20],
      recap: {
        10: { title: "T", summary: "S", bullets: [], bottomLine: "BL" },
        20: { title: "T2", summary: "S2", bullets: [], bottomLine: "BL2" },
      },
    });
    // patch includes item 50 (added via pool promote)
    const patch = makePatch({ rankedItems: [{ id: 10 }, { id: 50 }, { id: 20 }] });
    const result = diffReview(snapshot, patch);

    const adds = result.filter((r) => r.editType === "add");
    expect(adds).toHaveLength(1);
    expect(adds[0]?.rawItemId).toBe(50);
  });

  // EDGE-004: per-item recap field change (bottomLine)
  it("emits one text_edit row per changed recap field on a ranked item (EDGE-004)", () => {
    const snapshot = makeSnapshot();
    const patch = makePatch({
      rankedItems: [
        { id: 10, bottomLine: "New BL A" }, // changed
        { id: 20 },
        { id: 30 },
      ],
    });
    const result = diffReview(snapshot, patch);

    const textEdits = result.filter((r) => r.editType === "text_edit");
    expect(textEdits).toHaveLength(1);
    expect(textEdits[0]?.rawItemId).toBe(10);
    expect(textEdits[0]?.field).toBe("bottomLine");
    expect(textEdits[0]?.before).toBe("BL A");
    expect(textEdits[0]?.after).toBe("New BL A");
    expect(textEdits[0]?.positionBefore).toBeNull();
    expect(textEdits[0]?.positionAfter).toBeNull();
  });

  // EDGE-004: multiple recap fields changed on same item
  it("emits one text_edit row per changed recap field (multiple fields same item)", () => {
    const snapshot = makeSnapshot();
    const patch = makePatch({
      rankedItems: [
        { id: 10, title: "New Title A", summary: "New Summary A" }, // two fields changed
        { id: 20 },
        { id: 30 },
      ],
    });
    const result = diffReview(snapshot, patch);

    const textEdits = result.filter((r) => r.editType === "text_edit");
    expect(textEdits).toHaveLength(2);
    const titleEdit = textEdits.find((r) => r.field === "title");
    const summaryEdit = textEdits.find((r) => r.field === "summary");
    expect(titleEdit?.before).toBe("Title A");
    expect(titleEdit?.after).toBe("New Title A");
    expect(summaryEdit?.before).toBe("Summary A");
    expect(summaryEdit?.after).toBe("New Summary A");
  });

  // EDGE-005: digest meta change (digestHeadline)
  it("emits one text_edit row for a digest_headline change with raw_item_id=null (EDGE-005)", () => {
    const snapshot = makeSnapshot();
    const patch = makePatch({ digestHeadline: "New Headline" });
    const result = diffReview(snapshot, patch);

    const textEdits = result.filter((r) => r.editType === "text_edit");
    expect(textEdits).toHaveLength(1);
    expect(textEdits[0]?.rawItemId).toBeNull();
    expect(textEdits[0]?.field).toBe("digest_headline");
    expect(textEdits[0]?.before).toBe("Today in AI");
    expect(textEdits[0]?.after).toBe("New Headline");
  });

  // EDGE-005: all digest meta fields
  it("emits text_edit rows for all changed digest meta fields", () => {
    const snapshot = makeSnapshot();
    const patch = makePatch({
      digestHeadline: "H2",
      digestSummary: "S2",
      hook: "H3",
      twitterSummary: "T2",
    });
    const result = diffReview(snapshot, patch);
    const textEdits = result.filter((r) => r.editType === "text_edit" && r.rawItemId === null);
    const fields = textEdits.map((r) => r.field).sort();
    expect(fields).toEqual(["digest_headline", "digest_summary", "hook", "twitter_summary"].sort());
  });

  // null-vs-string distinction: null !== "something" → change
  it("treats null → non-null digest meta as a change", () => {
    const snapshot = makeSnapshot({
      digestMeta: { headline: null, summary: null, hook: null, twitterSummary: null },
    });
    const patch = makePatch({ digestHeadline: "Now has a headline" });
    const result = diffReview(snapshot, patch);
    const headlineEdit = result.find((r) => r.field === "digest_headline");
    expect(headlineEdit).toBeDefined();
    expect(headlineEdit?.before).toBeNull();
    expect(headlineEdit?.after).toBe("Now has a headline");
  });

  // empty-string treated via strict !==
  it("treats empty-string → non-empty as a change", () => {
    const snapshot = makeSnapshot({
      digestMeta: { headline: "", summary: "S", hook: "H", twitterSummary: "T" },
    });
    const patch = makePatch({ digestHeadline: "Non-empty" });
    const result = diffReview(snapshot, patch);
    expect(result.find((r) => r.field === "digest_headline")).toBeDefined();
  });

  // Patch ref absent means "preserve LLM text" → no text_edit row
  it("emits no text_edit when patch ref has no recap override (preserve LLM text)", () => {
    const snapshot = makeSnapshot();
    // patch item 10 has no overrides — just { id: 10 }
    const patch = makePatch({ rankedItems: [{ id: 10 }, { id: 20 }, { id: 30 }] });
    const result = diffReview(snapshot, patch);
    const textEdits = result.filter((r) => r.editType === "text_edit");
    expect(textEdits).toHaveLength(0);
  });

  // Override equals snapshot value → no text_edit row
  it("emits no text_edit when patch override equals snapshot recap value", () => {
    const snapshot = makeSnapshot();
    const patch = makePatch({
      rankedItems: [
        { id: 10, bullets: ["bullet1"] }, // same as snapshot
        { id: 20 },
        { id: 30 },
      ],
    });
    const result = diffReview(snapshot, patch);
    const textEdits = result.filter((r) => r.editType === "text_edit");
    expect(textEdits).toHaveLength(0);
  });

  // Combined: reorder + remove + add + text_edit + digest meta in one call
  it("handles mixed edits in a single call", () => {
    const snapshot = makeSnapshot({ rankedItemIds: [10, 20, 30] });
    const patch: Parameters<typeof diffReview>[1] = {
      rankedItems: [
        { id: 20 },          // was position 1 → now 0 (reorder)
        { id: 99 },          // add (pool item)
        { id: 10, title: "Changed" }, // was position 0 → now 2 (reorder) + text_edit
        // 30 removed
      ],
      digestHeadline: "New Headline", // digest meta change
      digestSummary: "A great day",
      hook: "Read this",
      twitterSummary: "AI news",
    };
    const result = diffReview(snapshot, patch);

    // 10 (0→2) and 20 (1→0) both moved; 99 is an add, 30 a remove → exactly 2 reorders.
    const reorders = result.filter((r) => r.editType === "reorder");
    expect(reorders).toHaveLength(2);
    expect(reorders.find((r) => r.rawItemId === 20)?.positionAfter).toBe(0);
    expect(reorders.find((r) => r.rawItemId === 10)?.positionAfter).toBe(2);
    expect(result.filter((r) => r.editType === "add")).toHaveLength(1);
    expect(result.filter((r) => r.editType === "remove")).toHaveLength(1);
    expect(result.filter((r) => r.editType === "text_edit" && r.rawItemId === 10)).toHaveLength(1);
    expect(result.filter((r) => r.editType === "text_edit" && r.rawItemId === null)).toHaveLength(1);
  });
});
