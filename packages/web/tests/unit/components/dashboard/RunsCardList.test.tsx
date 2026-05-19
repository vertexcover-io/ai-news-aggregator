import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsCardList } from "../../../../src/components/dashboard/RunsCardList";

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
