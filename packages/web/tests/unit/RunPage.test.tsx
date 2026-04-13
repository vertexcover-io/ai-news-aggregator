import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { RunPage } from "../../src/pages/RunPage";
import type { RunStateResponse } from "../../src/api/runs";

vi.mock("../../src/hooks/useRunPolling", () => ({
  useRunPolling: vi.fn(),
}));

vi.mock("../../src/api/runs", () => ({
  submitRun: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock("../../src/api/profiles", () => ({
  fetchProfiles: vi.fn().mockResolvedValue([]),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { useRunPolling } from "../../src/hooks/useRunPolling";
import { submitRun } from "../../src/api/runs";

function renderWithClient(ui: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(ui, { wrapper });
}

const baseCompletedRun: RunStateResponse = {
  id: "run-123",
  status: "completed",
  stage: "completed",
  topN: 10,
  startedAt: "2026-04-13T10:00:00Z",
  updatedAt: "2026-04-13T10:00:10Z",
  completedAt: "2026-04-13T10:00:10Z",
  sources: { hn: { status: "completed", itemsFetched: 5, errors: [] } },
  rankedItems: [],
  warnings: [],
  error: null,
};

async function renderAndSubmitRun(): Promise<void> {
  vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-123" });
  renderWithClient(<RunPage />);
  fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
  await waitFor(() => {
    expect(submitRun).toHaveBeenCalledTimes(1);
  });
}

describe("RunPage — View Archive button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("'View Archive' button is visible when data.status === 'completed' (REQ-001)", async () => {
    vi.mocked(useRunPolling).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunPolling>);

    await renderAndSubmitRun();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /view archive/i }),
      ).toBeTruthy();
    });
  });

  it("'View Archive' button is NOT visible when data.status === 'running' (REQ-001)", async () => {
    const runningRun: RunStateResponse = {
      ...baseCompletedRun,
      status: "running",
      stage: "collecting",
      completedAt: null,
      rankedItems: null,
    };
    vi.mocked(useRunPolling).mockReturnValue({
      isLoading: false,
      data: runningRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunPolling>);

    await renderAndSubmitRun();

    // Give React a moment to render the results
    await waitFor(() => {
      expect(screen.queryByText(/running/i)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /view archive/i })).toBeNull();
  });

  it("clicking 'View Archive' calls navigate with correct path (REQ-002)", async () => {
    vi.mocked(useRunPolling).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunPolling>);

    await renderAndSubmitRun();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /view archive/i }),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /view archive/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/archive/run-123");
  });
});
