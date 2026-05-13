import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ArchivePageHeader,
  formatLedgerEyebrow,
} from "../../src/components/ArchivePageHeader";

function renderHeader(props: {
  startedAt: string;
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
});

describe("ArchivePageHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders topStoryTitle as h1 and digestSummary as dek", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
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
      startedAt: "2026-04-18T10:00:00Z",
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
      startedAt: "2026-04-18T10:00:00Z",
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
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      topStoryTitle: null,
      digestHeadline: null,
    });
    expect(
      screen.getByRole("heading", { name: "An archived issue" }),
    ).toBeTruthy();
  });

  it("renders '1 story' (singular) for storyCount === 1", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 1,
      topStoryTitle: null,
    });
    expect(screen.getByText("1 story")).toBeTruthy();
  });

  it("renders '8 stories' (plural) for storyCount === 8", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 8,
      topStoryTitle: null,
    });
    expect(screen.getByText("8 stories")).toBeTruthy();
  });

  it("renders '0 stories' for storyCount === 0", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 0,
      topStoryTitle: null,
    });
    expect(screen.getByText("0 stories")).toBeTruthy();
  });

  it("does not render an inline back link inside the header (back link lives in a separate row)", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      topStoryTitle: null,
    });
    expect(screen.queryByRole("link", { name: /All issues|Back to archive/i })).toBeNull();
  });

  it("eyebrow element has font-mono", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      topStoryTitle: null,
    });
    const eyebrow = screen.getByText(/SATURDAY/);
    expect(eyebrow.className).toContain("font-mono");
  });

  it("h1 element has font-serif class", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      topStoryTitle: "Top Story Title",
    });
    const heading = screen.getByRole("heading");
    expect(heading.className).toContain("font-serif");
  });
});
