import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINKEDIN_HOOK,
  LINKEDIN_FOOTER,
} from "@newsletter/shared/constants";

import {
  TWITTER_MAX_CHARS,
  composePosts,
  twitterWeightedLength,
  type RankedStory,
} from "../../../src/social/compose.js";

const TEASER = "Full breakdown ↓";

function stories(n: number): RankedStory[] {
  const out: RankedStory[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      title: `Story ${String(i + 1)} title`,
      summary: `Summary ${String(i + 1)} body.`,
    });
  }
  return out;
}

describe("composePosts", () => {
  it("REQ-1/REQ-2 LinkedIn body uses DEFAULT_LINKEDIN_HOOK when hook is null", () => {
    const result = composePosts({ hook: null, stories: stories(3) });
    expect(result).not.toBeNull();
    const text = result?.linkedinText ?? "";
    expect(text.startsWith(`${DEFAULT_LINKEDIN_HOOK}\n\n→ Summary 1 body.`)).toBe(
      true,
    );
    expect(text.endsWith(`\n\n${LINKEDIN_FOOTER}`)).toBe(true);
  });

  it("REQ-3 LinkedIn body uses admin-edited hook verbatim when non-empty", () => {
    const result = composePosts({ hook: "Custom header", stories: stories(2) });
    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBe(
      ["Custom header", "→ Summary 1 body.", "→ Summary 2 body.", LINKEDIN_FOOTER].join(
        "\n\n",
      ),
    );
  });

  it("REQ-4 LinkedIn body caps bullets at 5", () => {
    const result = composePosts({ hook: null, stories: stories(7) });
    expect(result).not.toBeNull();
    const text = result?.linkedinText ?? "";
    expect(text).toContain("→ Summary 1 body.");
    expect(text).toContain("→ Summary 5 body.");
    expect(text).not.toContain("→ Summary 6 body.");
    expect(text).not.toContain("→ Summary 7 body.");
  });

  it("REQ-5 LinkedIn body emits fewer than 5 bullets when fewer ranked items", () => {
    const result = composePosts({ hook: null, stories: stories(3) });
    expect(result).not.toBeNull();
    const bullets = (result?.linkedinText ?? "")
      .split("\n\n")
      .filter((line) => line.startsWith("→ "));
    expect(bullets).toHaveLength(3);
  });

  it("REQ-11 LinkedIn body is null when no usable stories", () => {
    const result = composePosts({
      hook: "Custom",
      twitterSummary: "T",
      stories: [{ title: "T", summary: "" }],
    });
    expect(result).not.toBeNull();
    expect(result?.linkedinText).toBeNull();
  });

  it("VS-4 LinkedIn filters whitespace-only summaries before slicing top-5", () => {
    const result = composePosts({
      hook: null,
      stories: [
        { title: "A", summary: "first" },
        { title: "B", summary: "  " },
        { title: "C", summary: "third" },
      ],
    });
    expect(result).not.toBeNull();
    const text = result?.linkedinText ?? "";
    expect(text).toContain("→ first");
    expect(text).toContain("→ third");
    expect(text).not.toContain("→  ");
  });

  it("REQ-034 non-premium X post is twitterSummary followed by teaser (no URL — link is the reply)", () => {
    const result = composePosts({
      heading: "The interface becomes ambient",
      hook: "The interface is collapsing into one ambient layer.",
      twitterSummary: "A Twitter-native summary written for the feed.",
      stories: stories(3),
    });
    expect(result).not.toBeNull();
    expect(result?.twitter.ok).toBe(true);
    expect(result?.twitter.text).toBe(
      `A Twitter-native summary written for the feed.\n\n${TEASER}`,
    );
  });

  it("REQ-034 X post body does not contain the archive URL (link is posted as a reply) but ends with teaser", () => {
    const result = composePosts({
      hook: "Hook.",
      twitterSummary: "Short Twitter summary.",
      stories: stories(2),
    });
    expect(result).not.toBeNull();
    const text = result?.twitter.text ?? "";
    expect(text).not.toContain("https://");
    expect(text.endsWith(TEASER)).toBe(true);
    expect(twitterWeightedLength(text)).toBeLessThanOrEqual(TWITTER_MAX_CHARS);
  });

  it("REQ-035 non-premium X post excludes story bullets", () => {
    const result = composePosts({
      heading: "Digest heading",
      hook: "Hook.",
      twitterSummary: "Summary only.",
      stories: stories(4),
    });
    expect(result).not.toBeNull();
    expect(result?.twitter.text).not.toContain("→ Story 1 title");
    expect(result?.twitter.text).not.toContain("→ Story 2 title");
    expect(result?.twitter.text).not.toContain("→ Story 3 title");
    expect(result?.twitter.text).not.toContain("→ Story 4 title");
  });

  it("REQ-035 non-premium X post rejects over-limit text without truncation", () => {
    const longSummary = "x".repeat(281);
    const result = composePosts({
      heading: "Anthropic details Claude Code large-codebase patterns across enterprise monorepos",
      hook: "Fallback hook.",
      twitterSummary: longSummary,
      stories: [
        { title: "Anthropic details Claude Code large-codebase patterns across enterprise monorepos", summary: "Summary body." },
      ],
    });
    expect(result).not.toBeNull();
    const twitter = result?.twitter;
    expect(twitter?.ok).toBe(false);
    expect(twitter?.text).toContain(longSummary);
    expect(twitter?.text).not.toContain("…");
    expect(twitterWeightedLength(twitter?.text ?? "")).toBeGreaterThan(TWITTER_MAX_CHARS);
  });

  it("REQ-035 premium X post uses headline as lead, lists ranks two through four, ends with teaser, and does not embed the URL", () => {
    const longSummary = "Premium summary ".repeat(30).trim();
    const result = composePosts({
      heading: "Daily AI digest headline",
      hook: "Fallback hook.",
      twitterSummary: longSummary,
      twitterIsPremium: true,
      stories: stories(4),
    });
    expect(result).not.toBeNull();
    const twitter = result?.twitter;
    expect(twitter?.ok).toBe(true);
    const text = twitter?.text ?? "";
    expect(text.startsWith("Daily AI digest headline\n\n")).toBe(true);
    expect(text).toContain(`${longSummary}\n\nAlso inside:`);
    expect(text).not.toContain("→ Story 1 title");
    expect(text).toContain("→ Story 2 title");
    expect(text).toContain("→ Story 3 title");
    expect(text).toContain("→ Story 4 title");
    expect(text).not.toContain("Today in AI");
    expect(text).toContain(longSummary);
    expect(text.endsWith(`\n\n${TEASER}`)).toBe(true);
    expect(text).not.toContain("Full breakdown:");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("…");
  });

  it("REQ-035 premium X post omits Also inside when there are no follow-up stories but still ends with teaser", () => {
    const result = composePosts({
      heading: "Daily AI digest headline",
      hook: "Fallback hook.",
      twitterSummary: "Premium summary.",
      twitterIsPremium: true,
      stories: stories(1),
    });

    expect(result).not.toBeNull();
    expect(result?.twitter.text).toBe(
      ["Daily AI digest headline", "Premium summary.", TEASER].join("\n\n"),
    );
    expect(result?.twitter.text).not.toContain("Also inside:");
    expect(result?.twitter.text).not.toContain("→ Story 1 title");
  });

  it("REQ-035 non-premium legacy fallback uses hook plus teaser when twitterSummary is missing", () => {
    const result = composePosts({
      heading: "Codex supports multi-device remote control",
      hook: "OpenAI patched a 48-hour GPT-5.5 capability regression in Codex.",
      stories: [
        { title: "Codex supports multi-device remote control", summary: "Summary body." },
      ],
    });

    expect(result).not.toBeNull();
    const text = result?.twitter.text ?? "";
    expect(text).toBe(
      `OpenAI patched a 48-hour GPT-5.5 capability regression in Codex.\n\n${TEASER}`,
    );
    expect(text).not.toContain("→ ");
    expect(text).not.toContain("https://");
    expect(twitterWeightedLength(text)).toBeLessThanOrEqual(TWITTER_MAX_CHARS);
  });

  it("REQ-036 premium X post does not invent a generic heading when heading is missing", () => {
    const result = composePosts({
      hook: "Hook only.",
      twitterSummary: "Twitter summary.",
      twitterIsPremium: true,
      stories: [],
    });
    expect(result).not.toBeNull();
    expect(result?.twitter.text).toBe(`Twitter summary.\n\n${TEASER}`);
    expect(result?.twitter.text).not.toContain("Today in AI");
    expect(result?.twitter.text).not.toContain("https://");
  });
});
