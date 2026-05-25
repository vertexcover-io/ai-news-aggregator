import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodaysIssueBlock } from "../../../../src/components/home/TodaysIssueBlock";
import type { ArchiveListItem } from "@newsletter/shared/types";

afterEach(cleanup);

// Full fixture satisfying all ArchiveListItem fields
const baseIssue: ArchiveListItem = {
  runId: "run-abc-123",
  runDate: "2026-05-25",
  storyCount: 7,
  topItems: [
    { id: 1, title: "Claude Code ships first-class sub-agents", sourceType: "hn" },
    { id: 2, title: "The case against RAG, revisited", sourceType: "reddit" },
    { id: 3, title: "Cursor closes a $9B round", sourceType: "twitter" },
  ],
  leadSummary: "A week of self-healing loops.",
  digestHeadline: "Agents learn to recover from their own mistakes",
  digestSummary: "A week of self-healing loops, cheaper context windows.",
  isDryRun: false,
};

describe("TodaysIssueBlock", () => {
  // VS-1: No §-cover plate / role="img" plate
  it("VS-1: renders no role=img cover plate and no § character", () => {
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={baseIssue} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.textContent).not.toContain("§");
  });

  // VS-2: Exactly one anchor wrapping content
  it("VS-2: exactly one anchor with href to /archive/<runId> containing the headline", () => {
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={baseIssue} />
      </MemoryRouter>,
    );
    const anchors = container.querySelectorAll("a");
    expect(anchors.length).toBe(1);
    // querySelector returns Element | null — use it for the typed-null-safe access
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/archive/run-abc-123");
    // headline and a story title must be inside the anchor
    expect(anchor?.textContent).toContain("Agents learn to recover from their own mistakes");
    expect(anchor?.textContent).toContain("Claude Code ships first-class sub-agents");
  });

  // VS-3: Source labels mapped correctly
  it("VS-3: maps hn -> Hacker News and twitter -> X in source labels", () => {
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={baseIssue} />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Hacker News");
    expect(container.textContent).toContain("X");
  });

  // VS-4a: storyCount > topItems.length -> "+N more inside"
  it("VS-4a: shows '+ N more inside' when storyCount > topItems.length", () => {
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={baseIssue} />
      </MemoryRouter>,
    );
    // storyCount=7, topItems.length=3 → "+ 4 more inside"
    expect(container.textContent).toContain("+ 4 more inside");
  });

  // VS-4b: storyCount === topItems.length -> "Read today's issue"
  it("VS-4b: shows 'Read today's issue' when storyCount equals topItems.length", () => {
    const exactIssue: ArchiveListItem = {
      ...baseIssue,
      storyCount: 3,
    };
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={exactIssue} />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Read today’s issue");
    expect(container.textContent).not.toContain("more inside");
  });

  // VS-5a: empty topItems -> no <ol> rendered
  it("VS-5a: no running-order list when topItems is empty", () => {
    const noItemsIssue: ArchiveListItem = {
      ...baseIssue,
      topItems: [],
      storyCount: 0,
    };
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={noItemsIssue} />
      </MemoryRouter>,
    );
    expect(container.querySelector("ol")).toBeNull();
  });

  // VS-5b: null digestSummary -> dek absent
  it("VS-5b: dek is absent when digestSummary is null", () => {
    const noDekIssue: ArchiveListItem = {
      ...baseIssue,
      digestSummary: null,
    };
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={noDekIssue} />
      </MemoryRouter>,
    );
    expect(container.textContent).not.toContain("self-healing loops");
  });

  // VS-5c: null digestHeadline -> falls back to topItems[0].title
  it("VS-5c: falls back to topItems[0].title when digestHeadline is null", () => {
    const noHeadlineIssue: ArchiveListItem = {
      ...baseIssue,
      digestHeadline: null,
    };
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={noHeadlineIssue} />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Claude Code ships first-class sub-agents");
    // The literal fallback should NOT appear when topItems[0] is available
    expect(container.textContent).not.toContain("Today's issue");
  });

  // VS-5d: null digestHeadline AND empty topItems -> "Today's issue" literal
  it("VS-5d: falls back to literal when digestHeadline is null and topItems is empty", () => {
    const emptyIssue: ArchiveListItem = {
      ...baseIssue,
      digestHeadline: null,
      topItems: [],
      storyCount: 0,
    };
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={emptyIssue} />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Today's issue");
  });

  // REQ-8: data-section attribute retained
  it("retains data-section=todays-issue on the root element", () => {
    const { container } = render(
      <MemoryRouter>
        <TodaysIssueBlock issue={baseIssue} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-section="todays-issue"]')).not.toBeNull();
  });
});
