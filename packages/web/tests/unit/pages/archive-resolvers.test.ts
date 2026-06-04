import { describe, expect, it } from "vitest";
import { resolveIssueDate, resolveShareTitle } from "../../../src/pages/ArchivePage";

describe("resolveIssueDate", () => {
  it("returns empty string when both are absent", () => {
    expect(resolveIssueDate(null, null)).toBe("");
    expect(resolveIssueDate(undefined, undefined)).toBe("");
  });

  it("uses issueDate when available", () => {
    const result = resolveIssueDate("2025-06-04", "2025-06-03");
    expect(result).toContain("2025");
    expect(result).toContain("June");
  });

  it("falls back to startedAt when issueDate is absent", () => {
    const result = resolveIssueDate(null, "2025-01-15");
    expect(result).toContain("2025");
    expect(result).toContain("January");
  });

  it("handles ISO-date-only strings in UTC", () => {
    const result = resolveIssueDate("2025-03-20", null);
    expect(result).toContain("March");
    expect(result).toContain("20");
    expect(result).toContain("2025");
  });
});

describe("resolveShareTitle", () => {
  it("prefers topStoryTitle", () => {
    expect(resolveShareTitle("Top Story", "Digest Headline", "Fallback")).toBe("Top Story");
  });

  it("falls back to digestHeadline when topStoryTitle is null", () => {
    expect(resolveShareTitle(null, "Digest Headline", "Fallback")).toBe("Digest Headline");
  });

  it("falls back to fallbackTitle when both are null", () => {
    expect(resolveShareTitle(null, null, "Fallback")).toBe("Fallback");
  });
});
