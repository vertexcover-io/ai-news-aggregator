import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";

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
    ...overrides,
  };
}

function LocationCapture({ onLocation }: { onLocation: (path: string) => void }): null {
  const location = useLocation();
  onLocation(location.pathname);
  return null;
}

describe("RunsTable running state (REQ-001..REQ-005)", () => {
  it("REQ-001: clicking the Open button on a running run does not navigate", () => {
    const locations: string[] = [];
    render(
      <MemoryRouter initialEntries={["/"]}>
        <LocationCapture onLocation={(p) => locations.push(p)} />
        <RunsTable
          runs={[makeRun({ runId: "run-123", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
        />
      </MemoryRouter>,
    );
    const initialSnapshot = [...locations];
    const btn = screen.getByRole("button", { name: "Open" });
    fireEvent.click(btn);
    // Location should be unchanged after clicking the disabled button
    expect(locations).toEqual(initialSnapshot);
  });

  it("REQ-002: running run Open button has aria-disabled='true'", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-123", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: "Open" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("REQ-003: running run Open button has title='Available when the run completes.'", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-123", status: "running" })]}
          onRetry={vi.fn()}
          retrying={false}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: "Open" });
    expect(btn.getAttribute("title")).toBe("Available when the run completes.");
  });

  it("REQ-004: completed run renders 'View archive' link to /archive/:runId", () => {
    render(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ runId: "run-done", status: "completed", reviewed: true })]}
          onRetry={vi.fn()}
          retrying={false}
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
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /review/i });
    expect(link.getAttribute("href")).toBe("/review/run-pending");
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
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /view archive/i });
    expect(link.getAttribute("href")).toBe("/archive/run-done");
  });
});
