import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { HealthCheckButton } from "../../../../src/components/settings/HealthCheckButton";

vi.mock("../../../../src/hooks/useHealthCheck", () => ({
  useHealthCheckStatus: vi.fn(),
  useTriggerHealthCheck: vi.fn(),
}));

import { useHealthCheckStatus, useTriggerHealthCheck } from "../../../../src/hooks/useHealthCheck";

const mockUseHealthCheckStatus = useHealthCheckStatus as ReturnType<typeof vi.fn>;
const mockUseTriggerHealthCheck = useTriggerHealthCheck as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

function mockStatus(report: unknown = null) {
  mockUseHealthCheckStatus.mockReturnValue({
    report,
    isLoading: false,
    error: null,
  });
}

function mockTrigger(overrides: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  mockUseTriggerHealthCheck.mockReturnValue({
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
    error: null,
    mutate,
    ...overrides,
  });
  return mutate;
}

describe("HealthCheckButton", () => {
  it("renders 'Check Health' label and 'Not checked yet' when no report", () => {
    mockStatus(null);
    mockTrigger();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText("Check Health")).toBeTruthy();
    expect(screen.getByText("Not checked yet")).toBeTruthy();
  });

  it("has type='button' to avoid form submission", () => {
    mockStatus(null);
    mockTrigger();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("disables button and shows Checking... when trigger is pending", () => {
    mockStatus(null);
    mockTrigger({ isPending: true });
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByText("Checking...")).toBeTruthy();
  });

  it("calls mutate on click", () => {
    mockStatus(null);
    const mutate = mockTrigger();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("shows 'Healthy' when report has healthy result for this collector", () => {
    mockStatus({
      results: [{ collector: "hn", status: "healthy", durationMs: 100, itemsFound: 1 }],
      storedAt: "2026-06-02T12:00:00Z",
      totalDurationMs: 500,
      failedCount: 0,
      healthyCount: 1,
      skippedCount: 0,
    });
    mockTrigger();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText(/Healthy/)).toBeTruthy();
  });

  it("shows 'Failed' with error when report has failed result", () => {
    mockStatus({
      results: [{ collector: "hn", status: "failed", durationMs: 100, error: "API unreachable" }],
      storedAt: "2026-06-02T12:00:00Z",
      totalDurationMs: 500,
      failedCount: 1,
      healthyCount: 0,
      skippedCount: 0,
    });
    mockTrigger();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText(/Failed: API unreachable/)).toBeTruthy();
  });

  it("shows 'Skipped' when report has skipped result", () => {
    mockStatus({
      results: [{ collector: "hn", status: "skipped", durationMs: 0, reason: "no config" }],
      totalDurationMs: 0,
      failedCount: 0,
      healthyCount: 0,
      skippedCount: 1,
    });
    mockTrigger();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText(/Skipped/)).toBeTruthy();
    expect(screen.getByText(/no config/)).toBeTruthy();
  });
});
