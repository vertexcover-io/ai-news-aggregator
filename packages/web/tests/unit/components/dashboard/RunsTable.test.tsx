import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";

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
    ...overrides,
  };
}

describe("RunsTable CTA routing (REQ-110, REQ-111)", () => {
  it("renders 'Review' linking to /review/:runId when completed & not reviewed", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "run-pending",
              status: "completed",
              reviewed: false,
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /review/i });
    expect(link.getAttribute("href")).toBe("/review/run-pending");
  });

  it("renders 'View archive' linking to /archive/:runId when reviewed", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "run-done",
              status: "completed",
              reviewed: true,
            }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /view archive/i });
    expect(link.getAttribute("href")).toBe("/archive/run-done");
  });
});
