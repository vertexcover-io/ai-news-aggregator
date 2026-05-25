import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ArchiveListItem } from "@newsletter/shared/types";
import { TodaysIssueBlock } from "../../../src/components/home/TodaysIssueBlock";
import { pickHeadline } from "../../../src/components/ArchivePageHeader";

function makeIssue(overrides: Partial<ArchiveListItem> = {}): ArchiveListItem {
  return {
    runId: "run-001",
    runDate: "2026-05-25",
    storyCount: 5,
    topItems: [{ id: 1, title: "Top story", sourceType: "hn" }],
    leadSummary: null,
    digestHeadline: "Digest line",
    digestSummary: null,
    isDryRun: false,
    ...overrides,
  };
}

function renderBlock(issue: ArchiveListItem): void {
  render(
    <MemoryRouter>
      <TodaysIssueBlock issue={issue} />
    </MemoryRouter>,
  );
}

describe("TodaysIssueBlock headline precedence", () => {
  afterEach(() => {
    cleanup();
  });

  it("(a) both present & differ: shows top-story title, not digest headline", () => {
    const issue = makeIssue({
      topItems: [{ id: 1, title: "Top story", sourceType: "hn" }],
      digestHeadline: "Digest line",
    });
    renderBlock(issue);
    expect(
      screen.getByRole("heading", { level: 2, name: "Top story" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Digest line" })).toBeNull();
  });

  it("(b) both present & equal: shows that value", () => {
    const issue = makeIssue({
      topItems: [{ id: 1, title: "Same title", sourceType: "hn" }],
      digestHeadline: "Same title",
    });
    renderBlock(issue);
    expect(
      screen.getByRole("heading", { level: 2, name: "Same title" }),
    ).toBeTruthy();
  });

  it("(c) digest only (no topItems): shows digest headline", () => {
    const issue = makeIssue({
      topItems: [],
      digestHeadline: "Some digest",
    });
    renderBlock(issue);
    expect(
      screen.getByRole("heading", { level: 2, name: "Some digest" }),
    ).toBeTruthy();
  });

  it("(d) top story only (no digestHeadline): shows top-story title", () => {
    const issue = makeIssue({
      topItems: [{ id: 1, title: "Solo story", sourceType: "hn" }],
      digestHeadline: null,
    });
    renderBlock(issue);
    expect(
      screen.getByRole("heading", { level: 2, name: "Solo story" }),
    ).toBeTruthy();
  });

  it("(e) neither: shows 'An archived issue'", () => {
    const issue = makeIssue({
      topItems: [],
      digestHeadline: null,
    });
    renderBlock(issue);
    expect(
      screen.getByRole("heading", { level: 2, name: "An archived issue" }),
    ).toBeTruthy();
  });

  it("(e2) empty-string top-story title with non-empty digestHeadline: shows digestHeadline", () => {
    const issue = makeIssue({
      topItems: [{ id: 1, title: "", sourceType: "hn" }],
      digestHeadline: "Digest fallback headline",
    });
    renderBlock(issue);
    expect(
      screen.getByRole("heading", { level: 2, name: "Digest fallback headline" }),
    ).toBeTruthy();
  });

  it("(f) cross-surface invariant: rendered h2 matches pickHeadline for all cases", () => {
    const cases: ArchiveListItem[] = [
      makeIssue({
        topItems: [{ id: 1, title: "Top story", sourceType: "hn" }],
        digestHeadline: "Digest line",
      }),
      makeIssue({
        topItems: [{ id: 1, title: "Same title", sourceType: "hn" }],
        digestHeadline: "Same title",
      }),
      makeIssue({ topItems: [], digestHeadline: "Some digest" }),
      makeIssue({
        topItems: [{ id: 1, title: "Solo story", sourceType: "hn" }],
        digestHeadline: null,
      }),
      makeIssue({ topItems: [], digestHeadline: null }),
    ];

    for (const issue of cases) {
      cleanup();
      renderBlock(issue);
      const expected = pickHeadline(
        issue.topItems[0]?.title ?? null,
        issue.digestHeadline,
      );
      expect(
        screen.getByRole("heading", { level: 2, name: expected }),
      ).toBeTruthy();
    }
  });
});
