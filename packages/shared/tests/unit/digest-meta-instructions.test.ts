import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RANKING_PROMPT,
  DIGEST_META_INSTRUCTIONS,
  digestSchema,
} from "@shared/constants/index.js";

const FIXTURE = join(__dirname, "__fixtures__", "default-ranking-prompt.txt");

describe("DIGEST_META_INSTRUCTIONS extraction (REQ-001 / EDGE-007)", () => {
  it("REQ-001 / EDGE-007: DEFAULT_RANKING_PROMPT is byte-identical to the captured pre-refactor fixture", () => {
    const expected = readFileSync(FIXTURE, "utf8");
    expect(DEFAULT_RANKING_PROMPT).toBe(expected);
  });

  it("REQ-001: DEFAULT_RANKING_PROMPT composes DIGEST_META_INSTRUCTIONS verbatim", () => {
    expect(DEFAULT_RANKING_PROMPT).toContain(DIGEST_META_INSTRUCTIONS);
  });

  it("REQ-001: DIGEST_META_INSTRUCTIONS contains the four digest-field definitions and is standalone (no ranked-array sentence)", () => {
    expect(DIGEST_META_INSTRUCTIONS).toContain("digest.headline:");
    expect(DIGEST_META_INSTRUCTIONS).toContain("digest.summary:");
    expect(DIGEST_META_INSTRUCTIONS).toContain("digest.hook:");
    expect(DIGEST_META_INSTRUCTIONS).toContain("digest.twitterSummary:");
    // The rank-specific trailing sentence about the `ranked` array must NOT
    // be part of the standalone digest instructions.
    expect(DIGEST_META_INSTRUCTIONS).not.toContain("and a `ranked` array");
  });

  it("REQ-001: the ranked-array sentence stays in the ranking prompt", () => {
    expect(DEFAULT_RANKING_PROMPT).toContain("and a `ranked` array");
  });
});

describe("digestSchema (REQ-001)", () => {
  it("REQ-001: parses a well-formed 4-field digest object", () => {
    const parsed = digestSchema.parse({
      headline: "OpenAI ships GPT-5 with native tool use",
      summary: "Plus: Anthropic raises $5B and ARC-AGI-3 exposes reasoning gaps.",
      hook: "The AI stack just shifted under everyone's feet.",
      twitterSummary: "OpenAI shipped GPT-5 today with native tool use and a 400K context window.",
    });
    expect(parsed.headline).toBe("OpenAI ships GPT-5 with native tool use");
    expect(parsed.twitterSummary).toContain("GPT-5");
  });

  it("REQ-001: shape is exactly { headline, summary, hook, twitterSummary }", () => {
    const keys = Object.keys(digestSchema.shape).sort();
    expect(keys).toEqual(["headline", "hook", "summary", "twitterSummary"]);
  });

  it("REQ-001: rejects a non-string field", () => {
    const result = digestSchema.safeParse({
      headline: 42,
      summary: "ok",
      hook: "ok",
      twitterSummary: "ok",
    });
    expect(result.success).toBe(false);
  });
});
