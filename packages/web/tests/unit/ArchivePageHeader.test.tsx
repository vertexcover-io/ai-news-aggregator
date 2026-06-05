import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ArchivePageHeader,
  formatLedgerEyebrow,
} from "../../src/components/ArchivePageHeader";

function renderHeader(props: {
  issueDate: string;
  storyCount: number;
  topStoryTitle: string | null;
  digestHeadline?: string | null;
  digestSummary?: string | null;
}): void {
  render(
    <MemoryRouter>
      <ArchivePageHeader {...props} />
    </MemoryRouter>,
  );
}

describe("formatLedgerEyebrow", () => {
  it("returns weekday · month day · year (uppercase) with center dots", () => {
    // 2026-04-18 is a Saturday
    const result = formatLedgerEyebrow("2026-04-18T10:00:00Z");
    expect(result).toContain("SATURDAY");
    expect(result).toContain("APRIL 18");
    expect(result).toContain("2026");
    expect(result.split("·").length).toBe(3);
  });

  it("formats date-only issue dates without browser timezone drift", () => {
    expect(formatLedgerEyebrow("2026-05-23")).toBe(
      "SATURDAY · MAY 23 · 2026",
    );
  });
});

describe("ArchivePageHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders topStoryTitle as h1 and digestSummary as dek", () => {
    renderHeader({
      issueDate: "2026-04-18",
      storyCount: 5,
      topStoryTitle: "Top Story Title",
      digestSummary: "Plus: OpenAI launches GPT-5 with multimodal reasoning.",
    });
    expect(screen.getByRole("heading", { name: "Top Story Title" })).toBeTruthy();
    expect(
      screen.getByText("Plus: OpenAI launches GPT-5 with multimodal reasoning."),
    ).toBeTruthy();
  });

  it("falls back to topStoryTitle when digestSummary is null", () => {
    renderHeader({
      issueDate: "2026-04-18",
      storyCount: 5,
      topStoryTitle: "Top Story Title",
      digestSummary: null,
    });
    expect(
      screen.getByRole("heading", { name: "Top Story Title" }),
    ).toBeTruthy();
  });

  it("falls back to topStoryTitle when digestSummary is empty string (EDGE-011)", () => {
    renderHeader({
      issueDate: "2026-04-18",
      storyCount: 5,
      topStoryTitle: "Top Story Title",
      digestSummary: "",
    });
    expect(
      screen.getByRole("heading", { name: "Top Story Title" }),
    ).toBeTruthy();
  });

  it("uses 'An archived issue' when both digestHeadline and topStoryTitle are null", () => {
    renderHeader({
      issueDate: "2026-04-18",
      storyCount: 5,
      topStoryTitle: null,
      digestHeadline: null,
    });
    expect(
      screen.getByRole("heading", { name: "An archived issue" }),
    ).toBeTruthy();
  });

  // Story-count pluralization: singular for 1, plural for 0 and many.
  it.each([
    { storyCount: 1, expected: "1 story" },
    { storyCount: 8, expected: "8 stories" },
    { storyCount: 0, expected: "0 stories" },
  ])("renders '$expected' for storyCount === $storyCount", ({ storyCount, expected }) => {
    renderHeader({
      issueDate: "2026-04-18",
      storyCount,
      topStoryTitle: null,
    });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("does not render an inline back link inside the header (back link lives in a separate row)", () => {
    renderHeader({
      issueDate: "2026-04-18",
      storyCount: 5,
      topStoryTitle: null,
    });
    expect(screen.queryByRole("link", { name: /All issues|Back to archive/i })).toBeNull();
  });
});
