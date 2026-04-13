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

  it("renders formatted date from startedAt (REQ-008, REQ-014)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByText(/April 13, 2026/)).toBeTruthy();
  });

  it("renders story count as 'N stories' (REQ-008)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByText(/10 stories/)).toBeTruthy();
  });

  it("renders '1 story' for singular count (REQ-008)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 1, profileName: "aman" });
    expect(screen.getByText(/1 story/)).toBeTruthy();
  });

  it("renders '0 stories' for zero count (EDGE-002 related)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 0, profileName: "aman" });
    expect(screen.getByText(/0 stories/)).toBeTruthy();
  });

  it("renders profile name when provided (REQ-008)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    expect(screen.getByText(/profile: aman/)).toBeTruthy();
  });

  it("renders 'default' when profileName is null (EDGE-007)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: null });
    expect(screen.getByText(/profile: default/)).toBeTruthy();
  });

  it("renders '← Back to Run' link pointing to /run (REQ-013)", () => {
    renderHeader({ startedAt: "2026-04-13T10:00:00Z", storyCount: 10, profileName: "aman" });
    const link = screen.getByRole("link", { name: "← Back to Run" });
    expect(link.getAttribute("href")).toBe("/run");
  });
});
