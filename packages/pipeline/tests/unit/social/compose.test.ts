import { describe, expect, it } from "vitest";

import {
  TWITTER_MAX_CHARS,
  composePosts,
  twitterWeightedLength,
  type RankedStory,
} from "../../../src/social/compose.js";

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
  it("REQ-030 returns null only when both hook and twitterSummary are blank", () => {
    expect(composePosts({ hook: null, stories: stories(2) })).toBeNull();
    expect(composePosts({ hook: "   ", stories: stories(2) })).toBeNull();
    expect(
      composePosts({
        hook: null,
        twitterSummary: "Twitter summary.",
        stories: stories(2),
      }),
    ).not.toBeNull();
  });

  it("REQ-031 LinkedIn body starts with hook followed by first story", () => {
    const result = composePosts({
      hook: "Hook line.",
      stories: stories(3),
    });
    expect(result).not.toBeNull();
    expect(result?.linkedinText?.startsWith("Hook line.\n\n1) Story 1 title\n   Summary 1 body.")).toBe(true);
  });

  it("REQ-032 LinkedIn body lists numbered stories and does not embed the archive URL", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(3),
    });
    expect(result).not.toBeNull();
    const text = result?.linkedinText ?? "";
    expect(text).toContain("1) Story 1 title\n   Summary 1 body.");
    expect(text).toContain("2) Story 2 title\n   Summary 2 body.");
    expect(text).toContain("3) Story 3 title\n   Summary 3 body.");
    // The archive URL is posted as a comment by the notifier, not embedded here.
    expect(text).not.toContain("Full breakdown:");
    expect(text).not.toContain("https://");
    expect(text.endsWith("3) Story 3 title\n   Summary 3 body.")).toBe(true);
  });

  it("REQ-032 LinkedIn includes all ranked stories (no cap)", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(12),
    });
    expect(result).not.toBeNull();
    expect(result?.linkedinText).toContain("1) Story 1 title");
    expect(result?.linkedinText).toContain("12) Story 12 title");
  });

  it("REQ-034 non-premium X post is just the twitterSummary (no CTA, no URL — link is a reply)", () => {
    const result = composePosts({
      heading: "The interface becomes ambient",
      hook: "The interface is collapsing into one ambient layer.",
      twitterSummary: "A Twitter-native summary written for the feed.",
      stories: stories(3),
    });
    expect(result).not.toBeNull();
    expect(result?.twitter.ok).toBe(true);
    expect(result?.twitter.text).toBe(
      "A Twitter-native summary written for the feed.",
    );
  });

  it("REQ-034 X post body does not contain the archive URL (link is posted as a reply)", () => {
    const result = composePosts({
      hook: "Hook.",
      twitterSummary: "Short Twitter summary.",
      stories: stories(2),
    });
    expect(result).not.toBeNull();
    expect(result?.twitter.text).not.toContain("https://");
    expect(twitterWeightedLength(result?.twitter.text ?? "")).toBeLessThanOrEqual(TWITTER_MAX_CHARS);
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

  it("REQ-035 premium X post uses headline as lead, lists ranks two through four, and does not embed the URL", () => {
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
    expect(text).not.toContain("Full breakdown");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("…");
  });

  it("REQ-035 premium X post omits Also inside when there are no follow-up stories", () => {
    const result = composePosts({
      heading: "Daily AI digest headline",
      hook: "Fallback hook.",
      twitterSummary: "Premium summary.",
      twitterIsPremium: true,
      stories: stories(1),
    });

    expect(result).not.toBeNull();
    expect(result?.twitter.text).toBe(
      ["Daily AI digest headline", "Premium summary."].join("\n\n"),
    );
    expect(result?.twitter.text).not.toContain("Also inside:");
    expect(result?.twitter.text).not.toContain("→ Story 1 title");
  });

  it("REQ-035 non-premium legacy fallback uses hook only when twitterSummary is missing", () => {
    const result = composePosts({
      heading: "Codex supports multi-device remote control",
      hook: "OpenAI patched a 48-hour GPT-5.5 capability regression in Codex.",
      stories: [
        { title: "Codex supports multi-device remote control", summary: "Summary body." },
      ],
    });

    expect(result).not.toBeNull();
    const text = result?.twitter.text ?? "";
    expect(text).toBe("OpenAI patched a 48-hour GPT-5.5 capability regression in Codex.");
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
    expect(result?.twitter.text).toBe("Twitter summary.");
    expect(result?.twitter.text).not.toContain("Today in AI");
    expect(result?.twitter.text).not.toContain("https://");
  });
});
