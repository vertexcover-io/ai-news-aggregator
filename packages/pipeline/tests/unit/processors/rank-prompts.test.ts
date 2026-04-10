import { describe, it, expect } from "vitest";
import {
  SOURCE_NEUTRALITY_RULE,
  RANK_SYSTEM_PROMPT_PROFILED,
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

  describe("RANK_SYSTEM_PROMPT_PROFILED", () => {
    it("contains the source-neutrality rule verbatim (REQ-052)", () => {
      expect(RANK_SYSTEM_PROMPT_PROFILED.includes(SOURCE_NEUTRALITY_RULE)).toBe(
        true,
      );
    });

    it("names all four scoring axes (REQ-061)", () => {
      expect(RANK_SYSTEM_PROMPT_PROFILED).toContain("Relevance");
      expect(RANK_SYSTEM_PROMPT_PROFILED).toContain("Novelty");
      expect(RANK_SYSTEM_PROMPT_PROFILED).toContain("Signal-vs-hype");
      expect(RANK_SYSTEM_PROMPT_PROFILED).toContain("Actionability");
    });

    it("uses the word 'gating' and states Relevance caps the score (REQ-062)", () => {
      expect(RANK_SYSTEM_PROMPT_PROFILED).toContain("gating");
      expect(RANK_SYSTEM_PROMPT_PROFILED.toLowerCase()).toContain("cap");
    });

    it("does not hardcode domain keywords in the rubric (REQ-063)", () => {
      expect(RANK_SYSTEM_PROMPT_PROFILED).not.toContain(" AI ");
      expect(RANK_SYSTEM_PROMPT_PROFILED).not.toContain(" LLM ");
      expect(RANK_SYSTEM_PROMPT_PROFILED).not.toContain(" React ");
      expect(RANK_SYSTEM_PROMPT_PROFILED).not.toContain(" Python ");
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
