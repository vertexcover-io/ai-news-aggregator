import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { RunSummary } from "@newsletter/shared";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";
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
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    const headers = screen
      .getAllByRole("columnheader")
      .map((el) => el.textContent ?? "");
    const itemsIdx = headers.indexOf("Items");
    const sourcesIdx = headers.indexOf("Sources");
    const costIdx = headers.indexOf("Cost");
    const actionIdx = headers.indexOf("Action");
    expect(itemsIdx).toBeGreaterThanOrEqual(0);
    expect(sourcesIdx).toBe(itemsIdx + 1);
    expect(costIdx).toBe(sourcesIdx + 1);
    expect(actionIdx).toBe(costIdx + 1);
  });

  it("REQ-002: ready-to-review and reviewed rows render Sources links", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "a", status: "completed", reviewed: false }),
            makeRun({ runId: "b", status: "completed", reviewed: true }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.getAllByRole("link", { name: "Sources" })).toHaveLength(2);
  });

  it("REQ-003/EDGE-001: Sources action is hidden for failed runs", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "f", status: "failed", itemCount: 0 }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.queryByRole("link", { name: "Sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sources" })).toBeNull();
  });

  it("REQ-003: Sources action is hidden for cancelled runs", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "c", status: "cancelled", itemCount: 0 }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.queryByRole("link", { name: "Sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sources" })).toBeNull();
  });

  it("EDGE-002: Sources action is hidden for running runs", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[makeRun({ runId: "run-1", status: "running", itemCount: 3 })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.queryByRole("link", { name: "Sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sources" })).toBeNull();
  });

  it("EDGE-003: Sources action is hidden for cancelling runs", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[makeRun({ runId: "run-1", status: "cancelling" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.queryByRole("link", { name: "Sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sources" })).toBeNull();
  });

  it("REQ-004: Sources link routes to the full-page preview", () => {
    render(
      <Wrapper>
        <RunsTable
          runs={[
            makeRun({ runId: "run-xyz", status: "completed", reviewed: true }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    const link = screen.getByRole("link", { name: "Sources" });
    expect(link.getAttribute("href")).toBe("/admin/sources/run-xyz");
  });

  it("REQ-005: mobile card list routes Sources to the full-page preview", () => {
    render(
      <Wrapper>
        <RunsCardList
          runs={[
            makeRun({ runId: "mobile-run", status: "completed", reviewed: true }),
          ]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </Wrapper>,
    );
    const link = screen.getByRole("link", { name: "Sources" });
    expect(link.getAttribute("href")).toBe("/admin/sources/mobile-run");
  });
});
