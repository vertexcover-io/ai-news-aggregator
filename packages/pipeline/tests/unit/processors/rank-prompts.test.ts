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
  });
});
