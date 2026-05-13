import { describe, it, expect } from "vitest";
import {
  SOURCE_NEUTRALITY_RULE,
  RANK_SYSTEM_PROMPT_NO_PROFILE,
} from "@pipeline/processors/rank-prompts.js";

describe("rank prompts", () => {
  describe("SOURCE_NEUTRALITY_RULE", () => {
    it("is the exact verbatim spec string (REQ-052)", () => {
      expect(SOURCE_NEUTRALITY_RULE).toBe(
        "Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement.",
      );
    });
  });

  describe("RANK_SYSTEM_PROMPT_NO_PROFILE", () => {
    it("contains the source-neutrality rule verbatim (REQ-052)", () => {
      expect(
        RANK_SYSTEM_PROMPT_NO_PROFILE.includes(SOURCE_NEUTRALITY_RULE),
      ).toBe(true);
    });

    it("does not present Relevance as a scoring axis (REQ-070)", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).not.toContain("Relevance");
    });

    it("names the three topic-agnostic axes (REQ-070)", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Novelty");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Signal-vs-hype");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Actionability");
    });

    it("frames the reader as an AI practitioner tracking the AI world", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("AI practitioner");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "move the AI story forward",
      );
    });

    it("specifies the 3-4 minute total read budget framing", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("3-4 minute");
    });

    it("imposes a ≤25 word cap on summary", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("≤25 words");
    });

    it("requires exactly 3 bullets", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Exactly 3");
    });

    it("imposes a ≤15 word cap per bullet", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("≤15 words");
    });

    it("forbids analysis phrases inside bullets", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase()).toContain(
        "this signals",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase()).toContain(
        "this means",
      );
    });

    it("includes at least one Good: example per field (title/summary/bullets/bottomLine)", () => {
      const goodCount = (RANK_SYSTEM_PROMPT_NO_PROFILE.match(/Good:/g) ?? [])
        .length;
      // title (2 examples), summary (1), bullets (1 multi-line block), bottomLine (1) = 5 total
      expect(goodCount).toBeGreaterThanOrEqual(4);
    });

    it("specifies the 110-word hard ceiling and cut-order guidance", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("110 words");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase()).toContain(
        "cut bullets first",
      );
    });
  });
});
