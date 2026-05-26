import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

describe("RunsCardList social overflow menu (REQ-008)", () => {
  it("renders ⋮ More actions button per card", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "run-eligible",
              status: "completed",
              reviewed: true,
              isDryRun: false,
              linkedinPostedAt: null,
              twitterPostedAt: null,
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /more actions/i })).toBeTruthy();
  });

  it("opening ⋮ shows LinkedIn and X items", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "run-eligible",
              status: "completed",
              reviewed: true,
              isDryRun: false,
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menuitem", { name: /linkedin/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /\bx\b/i })).toBeTruthy();
  });
});

describe("RunsCardList cost button (REQ-060)", () => {
  it("REQ-060: every card has a data-testid=cost-button regardless of costBreakdown value", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({ runId: "r-a", status: "completed", reviewed: true, costBreakdown: null }),
            makeRun({
              runId: "r-b",
              status: "running",
              costBreakdown: {
                schemaVersion: 1,
                totalCostUsd: 0.5,
                stages: {},
                unknownModels: [],
                generatedAt: "2026-05-19T00:00:00Z",
              },
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("cost-button").length).toBe(2);
  });

  it("clicking the cost button opens dialog with correct total", async () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[
            makeRun({
              runId: "r-1",
              status: "completed",
              reviewed: true,
              costBreakdown: {
                schemaVersion: 1,
                totalCostUsd: 0.789,
                stages: {},
                unknownModels: [],
                generatedAt: "2026-05-19T00:00:00Z",
              },
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("cost-button"));
    await waitFor(() => {
      expect(screen.getByText(/Total:\s*\$0\.789/)).toBeTruthy();
    });
  });
});
