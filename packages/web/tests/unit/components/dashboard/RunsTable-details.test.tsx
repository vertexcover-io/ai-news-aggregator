import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";
import { RunsCardList } from "../../../../src/components/dashboard/RunsCardList";

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

describe("RunsTable observability link (REQ-031)", () => {
  it("REQ-031: each row links Details to /admin/runs/:runId", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-abc", status: "completed" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /details/i });
    expect(link.getAttribute("href")).toBe("/admin/runs/run-abc");
  });

  it("REQ-031: running rows also expose a Details link", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-live", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: /details/i }).getAttribute("href"),
    ).toBe("/admin/runs/run-live");
  });
});

describe("RunsCardList observability link (REQ-031)", () => {
  it("REQ-031: each card links Details to /admin/runs/:runId", () => {
    render(
      <MemoryRouter>
        <RunsCardList
          runs={[makeRun({ runId: "run-xyz", status: "failed" })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: /details/i }).getAttribute("href"),
    ).toBe("/admin/runs/run-xyz");
  });
});
