import { describe, it, expect } from "vitest";
import {
  SOURCE_NEUTRALITY_RULE,
  RANK_SYSTEM_PROMPT_NO_PROFILE,
  RECAP_VOICE_BLOCK,
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

    it("names the general developer-and-engineering-team axes (REQ-070)", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Developer-relevance");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Builder-impact");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Agentic-systems-relevance",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Evidence-quality");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Signal-vs-hype");
    });

    it("frames the reader as a developer, tech lead, or engineering manager", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("software developer");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("tech lead");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("engineering manager");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("share with their teams");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("coding agents");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("agentic AI tooling");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Prefer stories with practical consequences",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).not.toContain("Vertexcover");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).not.toContain("Harness engineering");
    });

    it("contains boost and downrank guidance for opinionated selection", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Boost primary-source releases",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("eval frameworks");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("observability");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("Downrank generic AI hype");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("funding-only stories");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("prompt-listicles");
    });

    it("tells the model to omit invalid or unrankable items instead of emitting placeholders", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("omit it entirely");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Never emit placeholder ranked entries",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Never invent, merge, concatenate, or alter item ids",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Every returned title must be non-empty",
      );
    });

    it("tells the model to collapse same-event coverage across different URLs and sources", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Treat same-event coverage as duplicates",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "even when the URLs, titles, or source types differ",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Return only the strongest representative",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "OpenAI ships Codex in ChatGPT mobile",
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

    it("defines summary, bullets, and bottomLine as non-overlapping editorial layers", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("summary = ORIENT");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("bullets = EXPLAIN");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("bottomLine = INTERPRET");
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "Each bullet must add new information not already stated in the summary",
      );
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(
        "If summary and bottomLine could both answer",
      );
    });
  });

  describe("editorial-stance recap content (VS-1, VS-2)", () => {
    // VS-1a: prompt contains editorial-stance directive scoped to bullets+bottomLine
    it("VS-1a: contains editorial-stance directive near 'before' or 'first' (REQ-001)", () => {
      expect(/our (editorial )?(take|stance|voice)/i.test(RANK_SYSTEM_PROMPT_NO_PROFILE)).toBe(true);
      // the directive must appear near "before" or "first" to scope it as a pre-writing step
      const stanceMatch = RANK_SYSTEM_PROMPT_NO_PROFILE.match(/our (editorial )?(take|stance|voice)/i);
      expect(stanceMatch).not.toBeNull();
      if (stanceMatch !== null && stanceMatch.index !== undefined) {
        const matchIndex: number = stanceMatch.index;
        const contextWindow = RANK_SYSTEM_PROMPT_NO_PROFILE.slice(
          Math.max(0, matchIndex - 300),
          matchIndex + 300,
        );
        expect(/before|first/i.test(contextWindow)).toBe(true);
      }
    });

    // VS-1b: voice claim appears in bullets and bottomLine descriptions
    it("VS-1b: voice claim appears in bullets and bottomLine field descriptions (REQ-003, REQ-004)", () => {
      // Find the bullets field description and check for "our" voice language
      const bulletsSection = RANK_SYSTEM_PROMPT_NO_PROFILE.slice(
        RANK_SYSTEM_PROMPT_NO_PROFILE.indexOf("bullets"),
      );
      const bottomLineSection = RANK_SYSTEM_PROMPT_NO_PROFILE.slice(
        RANK_SYSTEM_PROMPT_NO_PROFILE.indexOf("bottomLine"),
      );
      expect(/our (editorial )?(voice|stance|take)/i.test(bulletsSection)).toBe(true);
      expect(/our (editorial )?(voice|stance|take)/i.test(bottomLineSection)).toBe(true);
    });

    // VS-1c: positive regression guard — summary field description still contains "state what happened"
    it("VS-1c: summary description still contains 'state what happened' (REQ-002 — positive regression guard)", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE.toLowerCase()).toContain("state what happened");
    });

    // VS-2a: prompt contains a DO NOT block with at least 3 forbidden patterns
    it("VS-2a: prompt contains a DO NOT block with at least 3 forbidden patterns (REQ-005)", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain("DO NOT");
      const forbiddenPatterns = [
        "The author argues",
        "They say",
        "According to",
        "writes",
        "revolutionary",
        "inventing facts",
        "not in the source",
      ];
      const matched = forbiddenPatterns.filter((p) =>
        RANK_SYSTEM_PROMPT_NO_PROFILE.includes(p),
      );
      expect(matched.length).toBeGreaterThanOrEqual(3);
    });

    // VS-2b: prompt contains at least 2 Bad/Good example pairs
    it("VS-2b: prompt contains at least 2 Bad/Good example pairs (REQ-006)", () => {
      const badCount = (RANK_SYSTEM_PROMPT_NO_PROFILE.match(/\bBad\b/g) ?? []).length;
      const goodCountForVoice = (RANK_SYSTEM_PROMPT_NO_PROFILE.match(/\bGood\b/g) ?? []).length;
      // At least 2 Bad markers and corresponding Good markers from the voice block examples
      expect(badCount).toBeGreaterThanOrEqual(2);
      expect(goodCountForVoice).toBeGreaterThanOrEqual(2);
    });

    // Structural test: RECAP_VOICE_BLOCK is exported and included verbatim
    it("RANK_SYSTEM_PROMPT_NO_PROFILE includes RECAP_VOICE_BLOCK verbatim (REQ-001..REQ-006)", () => {
      expect(RANK_SYSTEM_PROMPT_NO_PROFILE).toContain(RECAP_VOICE_BLOCK);
    });
  });
});
