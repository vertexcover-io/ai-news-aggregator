import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";

// useTriggerSocialPost needs a QueryClient; mock it for these non-social tests
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

describe("RunsTable publish date (REQ-011)", () => {
  it("REQ-011: renders the effective publish date from issueDate in the row", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "run-pub",
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
    expect(screen.getByText("May 26, 2026")).toBeTruthy();
  });

  it("REQ-011: exposes a 'Publish date' column header", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-1", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Publish date")).toBeTruthy();
  });

  it("REQ-011/EDGE-003: renders an em-dash placeholder when issueDate is undefined", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "run-old",
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
    expect(screen.getByTestId("publish-date-cell").textContent).toBe("—");
  });
});

describe("RunsTable running state (REQ-001..REQ-005)", () => {
  it("REQ-001: running row renders Cancel button, not Open button (REQ-11)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RunsTable
          runs={[makeRun({ runId: "run-123", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("REQ-004: completed run renders 'View archive' link to /archive/:runId", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-done", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /view archive/i });
    expect(link.getAttribute("href")).toMatch(/\/archive\/run-done$/);
  });

  it("REQ-005: failed run still renders the Retry button", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-fail", status: "failed" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});

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
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /review/i });
    expect(link.getAttribute("href")).toBe("/admin/review/run-pending");
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
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /view archive/i });
    expect(link.getAttribute("href")).toBe("/archive/run-done");
  });
});

describe("RunsTable cancel button (REQ-11, REQ-12)", () => {
  it("REQ-11: renders destructive Cancel button for running row", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-active", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn).toBeTruthy();
  });

  it("REQ-11: renders disabled 'Cancelling…' button for cancelling row", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-cancelling", status: "cancelling" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: "Cancelling…" });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("REQ-11: renders Cancelled badge with no action button for cancelled row", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-cancelled", status: "cancelled" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Cancelled")).toBeTruthy();
    const buttons = screen.queryAllByRole("button");
    expect(buttons.some((b) => b.textContent === "Cancel")).toBe(false);
    expect(buttons.some((b) => b.textContent === "Retry")).toBe(false);
  });

  it("REQ-12: clicking Cancel opens confirmation dialog with correct title and description", async () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-active", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.getByText("Cancel this run?")).toBeTruthy();
      expect(screen.getByText("Items already collected will be discarded.")).toBeTruthy();
    });
  });

  it("REQ-12: confirming dialog triggers onCancel with the runId", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-active", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={onCancel}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.getByText("Cancel this run?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledWith("run-active");
    });
  });

  it("REQ-12: dismissing dialog does NOT trigger onCancel", async () => {
    const onCancel = vi.fn();
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-active", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={onCancel}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.getByText("Cancel this run?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    await waitFor(() => {
      expect(screen.queryByText("Cancel this run?")).toBeNull();
    });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("RunsTable cost button (REQ-060)", () => {
  it("REQ-060: every row has a data-testid=cost-button regardless of costBreakdown value", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({ runId: "r-a", status: "completed", reviewed: true, costBreakdown: null }),
            makeRun({
              runId: "r-b",
              status: "running",
              costBreakdown: {
                schemaVersion: 1,
                totalCostUsd: 0.123,
                stages: {},
                unknownModels: [],
                generatedAt: "2026-05-19T00:00:00Z",
              },
            }),
            makeRun({ runId: "r-c", status: "failed", costBreakdown: null }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const buttons = screen.getAllByTestId("cost-button");
    expect(buttons.length).toBe(3);
  });

  it("clicking cost button opens dialog with run's breakdown", async () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "r-1",
              status: "completed",
              reviewed: true,
              costBreakdown: {
                schemaVersion: 1,
                totalCostUsd: 0.444,
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
      expect(screen.getByText(/Total:\s*\$0\.444/)).toBeTruthy();
    });
  });
});

describe("RunsTable dry-run badge", () => {
  it("renders DRY RUN pill when run.isDryRun is true", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "run-dry",
              status: "completed",
              reviewed: false,
              isDryRun: true,
            }),
          ]}
          onRetry={() => undefined}
          retrying={false}
          onCancel={() => Promise.resolve()}
          onDelete={() => Promise.resolve()}
        />
      </MemoryRouter>,
    );
    const badges = screen.getAllByTestId("dry-run-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toMatch(/dry run/i);
  });

  it("does not render DRY RUN pill when run.isDryRun is false", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              runId: "run-live",
              status: "completed",
              reviewed: true,
              isDryRun: false,
            }),
          ]}
          onRetry={() => undefined}
          retrying={false}
          onCancel={() => Promise.resolve()}
          onDelete={() => Promise.resolve()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("dry-run-badge")).toBeNull();
  });
});
