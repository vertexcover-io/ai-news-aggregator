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

describe("observability Details link (REQ-031)", () => {
  // Both the desktop table and the mobile card list expose a Details link to
  // /admin/runs/:runId on every row, regardless of run status.
  it.each<{
    label: string;
    Component: typeof RunsTable | typeof RunsCardList;
    runId: string;
    status: RunSummary["status"];
  }>([
    { label: "RunsTable completed row", Component: RunsTable, runId: "run-abc", status: "completed" },
    { label: "RunsTable running row", Component: RunsTable, runId: "run-live", status: "running" },
    { label: "RunsCardList failed card", Component: RunsCardList, runId: "run-xyz", status: "failed" },
  ])("$label links Details to /admin/runs/:runId", ({ Component, runId, status }) => {
    render(
      <MemoryRouter>
        <Component
          runs={[makeRun({ runId, status })]}
          onRetry={vi.fn()}
          retrying={false}
          onCancel={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: /details/i }).getAttribute("href"),
    ).toBe(`/admin/runs/${runId}`);
  });
});
