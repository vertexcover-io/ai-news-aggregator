import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import type { RunSummary, UserSettings } from "@newsletter/shared";
import { DashboardPage } from "../../../src/pages/DashboardPage";

vi.mock("../../../src/api/runs", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/runs")>(
    "../../../src/api/runs",
  );
  return {
    ...actual,
    triggerRunNow: vi.fn(),
    listRuns: vi.fn(),
    cancelRun: vi.fn(),
  };
});

vi.mock("../../../src/api/settings", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/api/settings")
  >("../../../src/api/settings");
  return { ...actual, getSettings: vi.fn() };
});

vi.mock("../../../src/api/archives", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/api/archives")
  >("../../../src/api/archives");
  return { ...actual, deleteArchive: vi.fn() };
});

import { triggerRunNow, listRuns } from "../../../src/api/runs";
import { getSettings } from "../../../src/api/settings";

const settings: UserSettings = {
  id: "default",
  topN: 10,
  halfLifeHours: null,
  hnEnabled: true,
  hnConfig: null,
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  posthogEnabled: false,
  posthogProjectToken: null,
  posthogHost: null,
  scheduleTime: "07:00",
  pipelineTime: "07:00",
  emailTime: "07:00",
  linkedinTime: "07:00",
  twitterTime: "07:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
  emailEnabled: false,
  linkedinEnabled: false,
  twitterPostEnabled: false,
  autoReview: false,
  updatedAt: "2026-04-14T00:00:00Z",
};

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "r-1",
    startedAt: "2026-04-14T00:00:00Z",
    completedAt: "2026-04-14T00:01:00Z",
    status: "completed",
    itemCount: 10,
    reviewed: true,
    isDryRun: false,
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

beforeEach(() => {
  vi.mocked(triggerRunNow).mockReset();
  vi.mocked(listRuns).mockReset();
  vi.mocked(getSettings).mockReset();
  vi.mocked(triggerRunNow).mockResolvedValue({ runId: "new-run" });
  vi.mocked(listRuns).mockResolvedValue([makeRun()]);
  vi.mocked(getSettings).mockResolvedValue(settings);
});

afterEach(() => {
  cleanup();
});

describe("DashboardPage Run now split button", () => {
  it("primary Run now button calls triggerRunNow without dryRun", async () => {
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    const runButtons = await screen.findAllByRole("button", { name: /^run now$/i });
    // The primary split-button label
    fireEvent.click(runButtons[0]);
    await waitFor(() => {
      expect(triggerRunNow).toHaveBeenCalledTimes(1);
    });
    expect(triggerRunNow).toHaveBeenCalledWith(undefined);
  });

  it("'Run now (dry run)' menu item calls triggerRunNow with { dryRun: true }", async () => {
    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );
    const toggle = await screen.findByRole("button", { name: /more run options/i });
    fireEvent.click(toggle);
    const dryItem = await screen.findByRole("menuitem", { name: /run now \(dry run\)/i });
    fireEvent.click(dryItem);
    await waitFor(() => {
      expect(triggerRunNow).toHaveBeenCalledWith({ dryRun: true });
    });
  });
});
