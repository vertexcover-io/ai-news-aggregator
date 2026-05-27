import { describe, expect, it } from "vitest";

import { escapeLittleText } from "../../../../src/social/linkedin/little-text.js";

describe("escapeLittleText", () => {
  it("escapes the numbered-list ')' that truncated production posts", () => {
    // The exact shape that broke: a "1) summary" line. Without escaping,
    // LinkedIn drops everything from ")" onward.
    expect(escapeLittleText("1) Anthropic ships new model")).toBe(
      "1\\) Anthropic ships new model",
    );
  });

  it("escapes every reserved LTF character", () => {
    expect(escapeLittleText("| { } @ [ ] ( ) < > # * _ ~")).toBe(
      "\\| \\{ \\} \\@ \\[ \\] \\( \\) \\< \\> \\# \\* \\_ \\~",
    );
  });

  it("escapes a literal backslash, and escapes it before other chars", () => {
    // Backslash must be escaped first so the backslashes added for "(" are not
    // themselves doubled. "a\\(" -> "a\\\\\\(" (escaped backslash + escaped paren).
    expect(escapeLittleText("a\\(")).toBe("a\\\\\\(");
  });

  it("leaves non-reserved characters untouched, including newlines", () => {
    const input = "Hook line one.\n\nSummary with é, emoji 🚀, and a URL.";
    expect(escapeLittleText(input)).toBe(input);
  });

  it("returns an empty string unchanged", () => {
    expect(escapeLittleText("")).toBe("");
  });

  it("escapes parentheses appearing inside body prose", () => {
    expect(escapeLittleText("OpenAI (the company) released GPT")).toBe(
      "OpenAI \\(the company\\) released GPT",
    );
  });
});
