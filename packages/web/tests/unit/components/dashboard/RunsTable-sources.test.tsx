import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { RunSourcesResponse, RunSummary } from "@newsletter/shared";

vi.mock("../../../../src/api/runs", () => ({
  getRunSources: vi.fn(),
}));

import { getRunSources } from "../../../../src/api/runs";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";

afterEach(() => {
  cleanup();
  vi.mocked(getRunSources).mockReset();
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

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("RunsTable Sources column", () => {
  it("REQ-001: renders a Sources column header between Items and Action", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[makeRun({})]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    const headers = screen
      .getAllByRole("columnheader")
      .map((el) => el.textContent ?? "");
    const itemsIdx = headers.indexOf("Items");
    const sourcesIdx = headers.indexOf("Sources");
    const actionIdx = headers.indexOf("Action");
    expect(itemsIdx).toBeGreaterThanOrEqual(0);
    expect(sourcesIdx).toBe(itemsIdx + 1);
    expect(actionIdx).toBe(sourcesIdx + 1);
  });

  it("REQ-002: each row renders a Sources button", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "a", status: "running" }),
            makeRun({ runId: "b", status: "completed", reviewed: true }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.getAllByRole("button", { name: "Sources" }).length).toBe(2);
  });

  it("REQ-003/EDGE-001: Sources button disabled when status=failed and itemCount=0", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "f", status: "failed", itemCount: 0 }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole<HTMLButtonElement>("button", {
      name: "Sources",
    });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("No items collected");
  });

  it("REQ-003: Sources button disabled when status=cancelled and itemCount=0", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "c", status: "cancelled", itemCount: 0 }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole<HTMLButtonElement>("button", {
      name: "Sources",
    });
    expect(btn.disabled).toBe(true);
  });

  it("EDGE-002: Sources button enabled for a running run", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[makeRun({ runId: "run-1", status: "running", itemCount: 3 })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole<HTMLButtonElement>("button", {
      name: "Sources",
    });
    expect(btn.disabled).toBe(false);
  });

  it("REQ-004: clicking Sources opens dialog scoped to that row's runId", async () => {
    const resp: RunSourcesResponse = { runId: "run-xyz", items: [] };
    vi.mocked(getRunSources).mockResolvedValue(resp);
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "run-xyz", status: "completed", reviewed: true }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    await waitFor(() => {
      expect(vi.mocked(getRunSources)).toHaveBeenCalledWith("run-xyz");
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Sources/)).toBeTruthy();
  });
});
