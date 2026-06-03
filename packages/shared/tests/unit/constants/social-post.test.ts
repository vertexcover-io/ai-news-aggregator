import { describe, it, expect } from "vitest";
import {
  buildLinkedinPostBody,
  DEFAULT_LINKEDIN_HOOK,
  LINKEDIN_BULLET_PREFIX,
  LINKEDIN_FOOTER,
  LINKEDIN_MAX_STORIES,
} from "@shared/constants/social-post.js";

describe("buildLinkedinPostBody", () => {
  it("uses a non-empty string hook as the header", () => {
    const body = buildLinkedinPostBody("Custom Hook", []);
    expect(body.startsWith("Custom Hook")).toBe(true);
  });

  it("trims whitespace from the hook", () => {
    const body = buildLinkedinPostBody("  Trimmed  ", []);
    expect(body.startsWith("Trimmed")).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is null", () => {
    const body = buildLinkedinPostBody(null, []);
    expect(body.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is undefined", () => {
    const body = buildLinkedinPostBody(undefined, []);
    expect(body.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("falls back to DEFAULT_LINKEDIN_HOOK when hook is whitespace-only", () => {
    const body = buildLinkedinPostBody("   ", []);
    expect(body.startsWith(DEFAULT_LINKEDIN_HOOK)).toBe(true);
  });

  it("includes story summaries as bullets with the correct prefix", () => {
    const stories = [{ summary: "AI beats humans at coding" }];
    const body = buildLinkedinPostBody("Hook", stories);
    expect(body).toContain(`${LINKEDIN_BULLET_PREFIX}AI beats humans at coding`);
  });

  it("skips stories with null summary", () => {
    const stories = [{ summary: null }, { summary: "Valid story" }];
    const body = buildLinkedinPostBody("Hook", stories);
    const lines = body.split("\n\n");
    expect(lines.filter((l) => l.startsWith(LINKEDIN_BULLET_PREFIX))).toHaveLength(1);
    expect(body).toContain("Valid story");
  });

  it("skips stories with empty summary", () => {
    const stories = [{ summary: "" }, { summary: "Real story" }];
    const body = buildLinkedinPostBody("Hook", stories);
    expect(body).toContain("Real story");
    expect(body.split("\n\n").filter((l) => l.startsWith(LINKEDIN_BULLET_PREFIX))).toHaveLength(1);
  });

  it("skips stories with whitespace-only summary", () => {
    const stories = [{ summary: "   " }, { summary: "Valid" }];
    const body = buildLinkedinPostBody("Hook", stories);
    expect(body.split("\n\n").filter((l) => l.startsWith(LINKEDIN_BULLET_PREFIX))).toHaveLength(1);
  });

  it(`caps bullets at LINKEDIN_MAX_STORIES (${LINKEDIN_MAX_STORIES})`, () => {
    // 7 stories (LINKEDIN_MAX_STORIES=5 + 2 extras) to exercise the cap
    const stories: LinkedinPreviewStory[] = [
      { summary: "Story 1" },
      { summary: "Story 2" },
      { summary: "Story 3" },
      { summary: "Story 4" },
      { summary: "Story 5" },
      { summary: "Story 6" },
      { summary: "Story 7" },
    ];
    const body = buildLinkedinPostBody("Hook", stories);
    const bullets = body.split("\n\n").filter((l) => l.startsWith(LINKEDIN_BULLET_PREFIX));
    expect(bullets).toHaveLength(LINKEDIN_MAX_STORIES);
  });

  it("always ends with LINKEDIN_FOOTER", () => {
    const body = buildLinkedinPostBody("Hook", [{ summary: "A story" }]);
    expect(body.endsWith(LINKEDIN_FOOTER)).toBe(true);
  });

  it("produces header + footer only when stories list is empty", () => {
    const body = buildLinkedinPostBody("Hook", []);
    const lines = body.split("\n\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Hook");
    expect(lines[1]).toBe(LINKEDIN_FOOTER);
  });

  it("handles a single story correctly", () => {
    const body = buildLinkedinPostBody("Header", [{ summary: "Only story" }]);
    const parts = body.split("\n\n");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("Header");
    expect(parts[1]).toBe(`${LINKEDIN_BULLET_PREFIX}Only story`);
    expect(parts[2]).toBe(LINKEDIN_FOOTER);
  });
});
