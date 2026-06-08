import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsCardList } from "../../../../src/components/dashboard/RunsCardList";

// useTriggerSocialPost needs a QueryClient; mock it for these tests
vi.mock("../../../../src/hooks/useTriggerSocialPost", () => ({
  useTriggerSocialPost: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

afterEach(() => {
  cleanup();
});

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    runId: "r-1",
    startedAt: "2026-04-14T00:00:00Z",
    completedAt: "2026-04-14T00:01:00Z",
    status: "completed",
    itemCount: 10,
    reviewed: false,
    isDryRun: false,
    costBreakdown: null,
    ...overrides,
  };
}

describe("RunsCardList publish date (REQ-011)", () => {
  it("REQ-011: renders the effective publish date from issueDate", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "r-pub",
              status: "completed",
              reviewed: true,
              issueDate: "2026-05-26",
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Publish date")).toBeTruthy();
    expect(screen.getByText("May 26, 2026")).toBeTruthy();
  });

  it("REQ-011/EDGE-003: omits the publish date value when issueDate is undefined (old runs)", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "r-old",
              status: "completed",
              reviewed: true,
              issueDate: undefined,
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    // No crash; the publish date line is omitted entirely when absent.
    expect(screen.queryByText("Publish date")).toBeNull();
  });

  it("keeps the Started line rendering unchanged alongside the publish date", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "r-both",
              status: "completed",
              reviewed: true,
              startedAt: "2026-04-14T00:00:00Z",
              issueDate: "2026-05-26",
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getByText("Publish date")).toBeTruthy();
  });
});

describe("RunsCardList draft status (Phase 2)", () => {
  it("test_REQ_012_draft_row_links_to_review — draft card shows Review link to /admin/review/:runId", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "run-draft",
              status: "completed",
              reviewed: false,
              draftSavedAt: "2026-06-08T10:00:00Z",
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    // Draft badge is rendered
    expect(screen.getByText("Draft")).toBeTruthy();
    // CTA links to the review page (same as ready-to-review)
    const link = screen.getByRole("link", { name: /review/i });
    expect(link.getAttribute("href")).toBe("/admin/review/run-draft");
  });
});
