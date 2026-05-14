import { describe, expect, it } from "vitest";

import {
  TWITTER_MAX_CHARS,
  composePosts,
  type RankedStory,
} from "../../../src/social/compose.js";

const URL = "https://news.vertexcover.io/archive/abc123";

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
  it("REQ-030 returns null when hook is null or blank", () => {
    expect(
      composePosts({ hook: null, stories: stories(2), archiveUrl: URL }),
    ).toBeNull();
    expect(
      composePosts({ hook: "   ", stories: stories(2), archiveUrl: URL }),
    ).toBeNull();
  });

  it("REQ-031 LinkedIn body starts with hook followed by first story", () => {
    const result = composePosts({
      hook: "Hook line.",
      stories: stories(3),
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    expect(result?.linkedinText.startsWith("Hook line.\n\n1) Story 1 title\n   Summary 1 body.")).toBe(true);
  });

  it("REQ-032 LinkedIn body includes numbered stories and promo line", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(3),
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    expect(result?.linkedinText).toContain("1) Story 1 title\n   Summary 1 body.");
    expect(result?.linkedinText).toContain("2) Story 2 title\n   Summary 2 body.");
    expect(result?.linkedinText).toContain("3) Story 3 title\n   Summary 3 body.");
    expect(result?.linkedinText.endsWith(`\n\nFull breakdown: ${URL}`)).toBe(true);
  });

  it("REQ-032 LinkedIn includes all ranked stories (no cap)", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(12),
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    expect(result?.linkedinText).toContain("1) Story 1 title");
    expect(result?.linkedinText).toContain("12) Story 12 title");
  });

  it("REQ-034 Twitter thread first tweet is the hook", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(2),
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    expect(result?.twitterThread[0]).toBe("Hook.");
  });

  it("REQ-034 Twitter thread last tweet is the archive URL", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(2),
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    const thread = result?.twitterThread ?? [];
    expect(thread[thread.length - 1]).toBe(`Full breakdown: ${URL}`);
  });

  it("REQ-035 Twitter per-story tweets format as 'N) title\\nsummary'", () => {
    const result = composePosts({
      hook: "Hook.",
      stories: stories(3),
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    expect(result?.twitterThread[1]).toBe("1) Story 1 title\nSummary 1 body.");
    expect(result?.twitterThread[2]).toBe("2) Story 2 title\nSummary 2 body.");
    expect(result?.twitterThread[3]).toBe("3) Story 3 title\nSummary 3 body.");
  });

  it("REQ-035 Twitter per-story tweet truncates summary with ellipsis when over 280", () => {
    const longSummary = "x".repeat(400);
    const result = composePosts({
      hook: "Hook.",
      stories: [{ title: "Short title", summary: longSummary }],
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    const tweet = result?.twitterThread[1] ?? "";
    expect(tweet.length).toBeLessThanOrEqual(TWITTER_MAX_CHARS);
    expect(tweet.endsWith("…")).toBe(true);
    expect(tweet.startsWith("1) Short title\n")).toBe(true);
  });

  it("REQ-036 Twitter thread is exactly opener + closer when stories are empty", () => {
    const result = composePosts({
      hook: "Hook only.",
      stories: [],
      archiveUrl: URL,
    });
    expect(result).not.toBeNull();
    expect(result?.twitterThread).toEqual(["Hook only.", `Full breakdown: ${URL}`]);
  });
});
