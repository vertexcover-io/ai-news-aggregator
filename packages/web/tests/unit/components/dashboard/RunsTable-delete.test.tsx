import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const allRuns: RunSummary[] = [
  makeRun({ runId: "run-reviewed", status: "completed", reviewed: true }),
  makeRun({ runId: "run-failed", status: "failed", reviewed: false }),
  makeRun({ runId: "run-cancelled", status: "cancelled", reviewed: false }),
  makeRun({ runId: "run-running", status: "running", reviewed: false }),
  makeRun({ runId: "run-ready", status: "completed", reviewed: false }),
];

describe("RunsTable delete button (REQ-1, REQ-2)", () => {
  it("REQ-1: renders Delete button for reviewed, failed, cancelled, ready-to-review rows", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={allRuns}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    );
    const deleteButtons = screen.getAllByRole("button", {
      name: /delete newsletter/i,
    });
    // 4 visible: reviewed, failed, cancelled, ready (not running)
    expect(deleteButtons).toHaveLength(4);
  });

  it("REQ-2: does NOT render Delete button for running rows", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-running", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: /delete newsletter/i }),
    ).toBeNull();
  });
});

describe("RunsTable delete dialog (REQ-3, REQ-4, REQ-5)", () => {
  it("REQ-3: clicking Delete opens dialog with title and description", async () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-reviewed", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete newsletter/i }));
    await waitFor(() => {
      expect(screen.getByText("Delete this newsletter?")).toBeTruthy();
      expect(
        screen.getByText(
          "This permanently removes the archive and all delivery records. This cannot be undone.",
        ),
      ).toBeTruthy();
    });
  });

  it("REQ-4: clicking 'Keep it' closes dialog without calling onDelete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-reviewed", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn().mockResolvedValue(undefined)}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete newsletter/i }));
    await waitFor(() => {
      expect(screen.getByText("Delete this newsletter?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => {
      expect(screen.queryByText("Delete this newsletter?")).toBeNull();
    });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("REQ-5: clicking 'Delete newsletter' invokes onDelete with row's runId", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-target", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn().mockResolvedValue(undefined)}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete newsletter/i }));
    await waitFor(() => {
      expect(screen.getByText("Delete this newsletter?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete newsletter" }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith("run-target");
    });
  });

  it("REQ-5: buttons in dialog become disabled while delete is pending", async () => {
    const deferred: { resolve: () => void } = { resolve: () => undefined };
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          deferred.resolve = () => { resolve(); };
        }),
    );
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-target", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn().mockResolvedValue(undefined)}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete newsletter/i }));
    await waitFor(() => {
      expect(screen.getByText("Delete this newsletter?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete newsletter" }));
    await waitFor(() => {
      const deletingBtn = screen.getByRole("button", { name: /deleting/i });
      expect((deletingBtn as HTMLButtonElement).disabled).toBe(true);
      const keepBtn = screen.getByRole("button", { name: "Keep it" });
      expect((keepBtn as HTMLButtonElement).disabled).toBe(true);
    });
    // Cleanup the pending promise
    deferred.resolve();
  });
});
