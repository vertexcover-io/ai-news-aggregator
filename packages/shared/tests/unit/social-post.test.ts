import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINKEDIN_HOOK,
  LINKEDIN_FOOTER,
  LINKEDIN_MAX_STORIES,
  buildLinkedinPostBody,
} from "@shared/constants/social-post.js";

describe("buildLinkedinPostBody", () => {
  it("starts with the explicit hook string when provided", () => {
    const result = buildLinkedinPostBody("My Custom Hook", []);

    expect(result.startsWith("My Custom Hook")).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is null", () => {
    const result = buildLinkedinPostBody(null, []);

    expect(result.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is undefined", () => {
    const result = buildLinkedinPostBody(undefined, []);

    expect(result.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is an empty string", () => {
    const result = buildLinkedinPostBody("", []);

    expect(result.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is whitespace-only", () => {
    const result = buildLinkedinPostBody("   ", []);

    expect(result.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("formats stories as bullet lines with '→ ' prefix", () => {
    const stories = [{ summary: "First story" }, { summary: "Second story" }];
    const result = buildLinkedinPostBody("Hook", stories);

    expect(result).toContain("→ First story");
    expect(result).toContain("→ Second story");
  });

  it("skips stories with empty summaries", () => {
    const stories = [
      { summary: "Valid story" },
      { summary: "" },
      { summary: null },
      { summary: undefined },
      { summary: "Another valid" },
    ];
    const result = buildLinkedinPostBody("Hook", stories);
    const lines = result.split("\n\n");

    // Only two bullets expected
    const bullets = lines.filter((l) => l.startsWith("→ "));
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toBe("→ Valid story");
    expect(bullets[1]).toBe("→ Another valid");
  });

  it(`drops extra stories beyond LINKEDIN_MAX_STORIES (${LINKEDIN_MAX_STORIES})`, () => {
    const maxStories: number = LINKEDIN_MAX_STORIES;
    const stories = Array.from({ length: maxStories + 3 }, (_: unknown, i: number) => ({
      summary: `Story ${String(i + 1)}`,
    }));
    const result = buildLinkedinPostBody("Hook", stories);
    const bullets = result.split("\n\n").filter((l) => l.startsWith("→ "));

    expect(bullets).toHaveLength(LINKEDIN_MAX_STORIES);
  });

  it("always ends with the footer", () => {
    const result = buildLinkedinPostBody("Hook", [{ summary: "A story" }]);

    expect(result.endsWith(LINKEDIN_FOOTER)).toBe(true);
  });

  it("ends with footer even when stories array is empty", () => {
    const result = buildLinkedinPostBody("Hook", []);

    expect(result.endsWith(LINKEDIN_FOOTER)).toBe(true);
  });

  it("includes header and footer even with no stories", () => {
    const result = buildLinkedinPostBody("My Header", []);
    const parts = result.split("\n\n");

    expect(parts[0]).toBe("My Header");
    expect(parts[parts.length - 1]).toBe(LINKEDIN_FOOTER);
  });

  it("separates sections with double newlines", () => {
    const stories = [{ summary: "Story one" }];
    const result = buildLinkedinPostBody("Hook", stories);

    expect(result).toBe(`Hook\n\n→ Story one\n\n${LINKEDIN_FOOTER}`);
  });
});
