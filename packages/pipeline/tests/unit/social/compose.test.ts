import { describe, expect, it } from "vitest";

import {
  TWITTER_MAX_CHARS,
  TWITTER_URL_LENGTH,
  composePosts,
} from "../../../src/social/compose.js";

const URL = "https://example.com/archive/abc123";

describe("composePosts", () => {
  it("REQ-010 builds full template with headline, summary, and url for both platforms", () => {
    const result = composePosts({
      digestHeadline: "AI labs ship new reasoning models",
      digestSummary: "A short recap of today's biggest stories.",
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBe(
      `AI labs ship new reasoning models\n\nA short recap of today's biggest stories.\n\n${URL}`,
    );
    expect(result?.twitterText).toBe(
      `AI labs ship new reasoning models\n\nA short recap of today's biggest stories.\n\n${URL}`,
    );
  });

  it("REQ-011 omits summary line and double-blank when summary is null", () => {
    const result = composePosts({
      digestHeadline: "Headline only",
      digestSummary: null,
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBe(`Headline only\n\n${URL}`);
    expect(result?.twitterText).toBe(`Headline only\n\n${URL}`);
    expect(result?.linkedinText).not.toContain("\n\n\n");
  });

  it("REQ-011 treats empty-string summary the same as null", () => {
    const result = composePosts({
      digestHeadline: "Headline only",
      digestSummary: "   ",
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBe(`Headline only\n\n${URL}`);
    expect(result?.twitterText).toBe(`Headline only\n\n${URL}`);
  });

  it("REQ-014 returns null when headline is null", () => {
    const result = composePosts({
      digestHeadline: null,
      digestSummary: "anything",
      archiveUrl: URL,
    });
    expect(result).toBeNull();

    const blank = composePosts({
      digestHeadline: "   ",
      digestSummary: "anything",
      archiveUrl: URL,
    });
    expect(blank).toBeNull();
  });

  it("REQ-012 EDGE-002 keeps text intact when twitter length is exactly 280", () => {
    // Budget for headline + summary = 255 chars (incl. one \n\n separator).
    // Use headline of 100 chars, summary of 153 chars: 100 + 2 + 153 = 255.
    const headline = "H".repeat(100);
    const summary = "S".repeat(153);

    const result = composePosts({
      digestHeadline: headline,
      digestSummary: summary,
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    const effectiveLen =
      headline.length + 2 + summary.length + 2 + TWITTER_URL_LENGTH;
    expect(effectiveLen).toBe(TWITTER_MAX_CHARS);
    expect(result?.twitterText).toBe(`${headline}\n\n${summary}\n\n${URL}`);
    expect(result?.linkedinText).toBe(`${headline}\n\n${summary}\n\n${URL}`);
  });

  it("REQ-013 EDGE-003 truncates summary first with ellipsis when one char over", () => {
    const headline = "H".repeat(100);
    const summary = "S".repeat(154); // 100 + 2 + 154 = 256, total 281 with url+separator

    const result = composePosts({
      digestHeadline: headline,
      digestSummary: summary,
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBe(`${headline}\n\n${summary}\n\n${URL}`);
    // Summary truncated to fit (REQ-013), keeping as much of it as possible.
    // Budget for headline+separator+summary = 280-23-2 = 255. Headline=100, separator=2, so summary budget = 153.
    // Truncated summary = 152 chars of S + "…" = 153 chars total.
    const expectedSummary = `${"S".repeat(152)}…`;
    expect(result?.twitterText).toBe(`${headline}\n\n${expectedSummary}\n\n${URL}`);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.twitterText.length - URL.length + TWITTER_URL_LENGTH).toBeLessThanOrEqual(TWITTER_MAX_CHARS);
  });

  it("REQ-013 drops summary entirely when even one-char summary won't fit", () => {
    const headline = "H".repeat(254); // headline + separator + 1 char + separator + url = 254+2+1+2+23 = 282 > 280
    const summary = "S".repeat(50);

    const result = composePosts({
      digestHeadline: headline,
      digestSummary: summary,
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    // Headline alone fits (254+2+23=279), summary dropped entirely.
    expect(result?.twitterText).toBe(`${headline}\n\n${URL}`);
  });

  it("REQ-013 EDGE-004 truncates long headline with ellipsis when even headline-only is over budget", () => {
    const headline = "H".repeat(300);
    const summary = "Some summary";

    const result = composePosts({
      digestHeadline: headline,
      digestSummary: summary,
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBe(`${headline}\n\n${summary}\n\n${URL}`);

    const expectedHeadline = `${"H".repeat(254)}…`;
    expect(result?.twitterText).toBe(`${expectedHeadline}\n\n${URL}`);
    // Effective tweet length: 255 (headline budget) + 2 + 23 = 280.
    const effective = 255 + 2 + TWITTER_URL_LENGTH;
    expect(effective).toBe(TWITTER_MAX_CHARS);
  });

  it("EDGE-014 preserves the archive url even when the headline contains url-like text", () => {
    const headline = "Visit https://decoy.example.com/post/12345 today";
    const summary = "Short summary";

    const result = composePosts({
      digestHeadline: headline,
      digestSummary: summary,
      archiveUrl: URL,
    });

    expect(result).not.toBeNull();
    // Archive URL preserved verbatim at the end of both bodies.
    expect(result?.linkedinText.endsWith(`\n\n${URL}`)).toBe(true);
    expect(result?.twitterText.endsWith(`\n\n${URL}`)).toBe(true);
    // Headline text not stripped or mistaken for the URL.
    expect(result?.linkedinText).toContain(headline);
    expect(result?.twitterText).toContain(headline);
  });
});
