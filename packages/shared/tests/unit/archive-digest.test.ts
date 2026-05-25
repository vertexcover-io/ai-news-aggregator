import { describe, expect, it } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";
import { deriveReviewedArchiveDigest } from "@newsletter/shared";

const baseRawItem = {
  id: 1,
  title: "Raw source title",
  metadata: {},
};

describe("deriveReviewedArchiveDigest", () => {
  it("REQ-003: uses rank-one inline title and summary before recap metadata", () => {
    const rankedItems: RankedItemRef[] = [
      {
        rawItemId: 1,
        score: 0,
        rationale: "",
        title: "Operator headline",
        summary: "Operator summary",
      },
    ];

    const digest = deriveReviewedArchiveDigest({
      rankedItems,
      rawItemsById: new Map([
        [
          1,
          {
            ...baseRawItem,
            metadata: {
              recap: {
                title: "Recap headline",
                summary: "Recap summary",
              },
            },
          },
        ],
      ]),
      fallbackDigestHeadline: "Old headline",
      fallbackDigestSummary: "Old summary",
    });

    expect(digest).toEqual({
      digestHeadline: "Operator headline",
      digestSummary: "Operator summary",
    });
  });

  it("REQ-006: falls back from blank inline title to recap title then raw title", () => {
    const rankedItems: RankedItemRef[] = [
      {
        rawItemId: 1,
        score: 0,
        rationale: "",
        title: "   ",
      },
    ];

    const digest = deriveReviewedArchiveDigest({
      rankedItems,
      rawItemsById: new Map([
        [
          1,
          {
            ...baseRawItem,
            metadata: {
              recap: {
                title: "Recap headline",
              },
            },
          },
        ],
      ]),
      fallbackDigestHeadline: "Old headline",
      fallbackDigestSummary: "Old summary",
    });

    expect(digest.digestHeadline).toBe("Recap headline");
  });

  it("EDGE-004: preserves existing digest summary when rank one has no summary", () => {
    const rankedItems: RankedItemRef[] = [
      { rawItemId: 1, score: 0, rationale: "", title: "New headline" },
    ];

    const digest = deriveReviewedArchiveDigest({
      rankedItems,
      rawItemsById: new Map([[1, baseRawItem]]),
      fallbackDigestHeadline: "Old headline",
      fallbackDigestSummary: "Existing summary",
    });

    expect(digest).toEqual({
      digestHeadline: "New headline",
      digestSummary: "Existing summary",
    });
  });
});
