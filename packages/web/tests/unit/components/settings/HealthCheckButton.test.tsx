import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { HealthCheckButton } from "../../../../src/components/settings/HealthCheckButton";

vi.mock("../../../../src/hooks/useHealthCheck", () => ({
  useHealthCheck: vi.fn(),
}));

import { useHealthCheck } from "../../../../src/hooks/useHealthCheck";

const mockUseHealthCheck = useHealthCheck as ReturnType<typeof vi.fn>;

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

describe("HealthCheckButton", () => {
  function mockState(overrides: Record<string, unknown> = {}) {
    const mutate = vi.fn();
    mockUseHealthCheck.mockReturnValue({
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

  it("renders 'Check Health' label by default", () => {
    mockState();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText("Check Health")).toBeTruthy();
  });

  it("has type='button' to avoid form submission", () => {
    mockState();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("shows disabled button when pending", () => {
    mockState({ isPending: true });
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("disabled")).not.toBeNull();
  });

  it("calls mutate on click", () => {
    const mutate = mockState();
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("shows 'Healthy' text on success", () => {
    mockState({ isSuccess: true, data: { jobId: "job-1" } });
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText("Healthy")).toBeTruthy();
  });

  it("shows error text on failure", () => {
    mockState({ isError: true, error: new Error("Connection failed") });
    render(
      <TestWrapper>
        <HealthCheckButton collector="hn" label="Hacker News" />
      </TestWrapper>,
    );
    expect(screen.getByText("Connection failed")).toBeTruthy();
  });
});
