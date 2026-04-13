import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArchivePageHeader } from "../../src/components/ArchivePageHeader";

function renderHeader(props: {
  startedAt: string;
  storyCount: number;
  profileName: string | null;
}): void {
  render(
    <MemoryRouter>
      <ArchivePageHeader {...props} />
    </MemoryRouter>,
  );
}

describe("ArchivePageHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 'AI Newsletter' heading", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByRole("heading", { name: "AI Newsletter" })).toBeTruthy();
  });

  it("renders tagline 'Your AI News Digest'", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: null });
    expect(screen.getByText("Your AI News Digest")).toBeTruthy();
  });

  it("renders formatted date from startedAt", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByText(/April 13, 2026/)).toBeTruthy();
  });

  it("renders story count as 'N stories'", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByText(/10 stories/)).toBeTruthy();
  });

  it("renders '1 story' for singular count", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 1, profileName: "aman" });
    expect(screen.getByText(/1 story/)).toBeTruthy();
  });

  it("renders '0 stories' for zero count", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 0, profileName: "aman" });
    expect(screen.getByText(/0 stories/)).toBeTruthy();
  });

  it("renders profile name when provided", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByText(/aman/)).toBeTruthy();
  });

  it("omits profile name when null", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: null });
    expect(screen.queryByText(/profile/)).toBeNull();
  });

  it("renders '← Back to Run' link pointing to /run", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    const link = screen.getByRole("link", { name: "← Back to Run" });
    expect(link.getAttribute("href")).toBe("/run");
  });
});
