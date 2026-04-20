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
  leadSummary: string | null;
  topStoryTitle: string | null;
}): void {
  render(
    <MemoryRouter>
      <ArchivePageHeader {...props} />
    </MemoryRouter>,
  );
}

describe("formatLedgerEyebrow", () => {
  it("returns weekday and date in uppercase with center dot", () => {
    // 2026-04-18 is a Saturday (UTC)
    const result = formatLedgerEyebrow("2026-04-18T10:00:00Z");
    expect(result).toContain("SATURDAY");
    expect(result).toContain("APRIL 18, 2026");
    expect(result).toContain("·");
  });
});

describe("ArchivePageHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders leadSummary as h1 when present", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: "OpenAI launches GPT-5 with multimodal reasoning.",
      topStoryTitle: "Top Story Title",
    });
    expect(
      screen.getByRole("heading", {
        name: "OpenAI launches GPT-5 with multimodal reasoning.",
      }),
    ).toBeTruthy();
  });

  it("falls back to topStoryTitle when leadSummary is null", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: null,
      topStoryTitle: "Top Story Title",
    });
    expect(
      screen.getByRole("heading", { name: "Top Story Title" }),
    ).toBeTruthy();
  });

  it("falls back to topStoryTitle when leadSummary is empty string (EDGE-011)", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: "",
      topStoryTitle: "Top Story Title",
    });
    expect(
      screen.getByRole("heading", { name: "Top Story Title" }),
    ).toBeTruthy();
  });

  it("uses 'An archived issue' when both leadSummary and topStoryTitle are null", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: null,
      topStoryTitle: null,
    });
    expect(
      screen.getByRole("heading", { name: "An archived issue" }),
    ).toBeTruthy();
  });

  it("renders '1 story' (singular) for storyCount === 1", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 1,
      leadSummary: null,
      topStoryTitle: null,
    });
    expect(screen.getByText("1 story")).toBeTruthy();
  });

  it("renders '8 stories' (plural) for storyCount === 8", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 8,
      leadSummary: null,
      topStoryTitle: null,
    });
    expect(screen.getByText("8 stories")).toBeTruthy();
  });

  it("renders '0 stories' for storyCount === 0", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 0,
      leadSummary: null,
      topStoryTitle: null,
    });
    expect(screen.getByText("0 stories")).toBeTruthy();
  });

  it("renders back link as <a> with href='/' and text '← All issues'", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: null,
      topStoryTitle: null,
    });
    const link = screen.getByRole("link", { name: "← All issues" });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("eyebrow element has font-mono and tracking-widest classes", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: null,
      topStoryTitle: null,
    });
    // 2026-04-18 is a Saturday — match the actual rendered weekday
    const eyebrow = screen.getByText(/SATURDAY/);
    expect(eyebrow.className).toContain("font-mono");
    expect(eyebrow.className).toContain("tracking-widest");
  });

  it("h1 element has font-serif class", () => {
    renderHeader({
      startedAt: "2026-04-18T10:00:00Z",
      storyCount: 5,
      leadSummary: "Some lead summary",
      topStoryTitle: null,
    });
    const heading = screen.getByRole("heading");
    expect(heading.className).toContain("font-serif");
  });
});
