import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";
import { RunObservabilityPage } from "../../../../src/pages/RunObservabilityPage";
import { fullFixture, legacyFixture } from "./fixtures";

vi.mock("../../../../src/api/runs", () => ({
  getRunObservability: vi.fn(),
}));

import { getRunObservability } from "../../../../src/api/runs";

afterEach(() => {
  cleanup();
});

function renderPage(runId: string): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/runs/${runId}`]}>
          <Routes>
            <Route path="/admin/runs/:runId" element={<RunObservabilityPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

describe("RunObservabilityPage", () => {
  beforeEach(() => {
    vi.mocked(getRunObservability).mockReset();
  });

  it("REQ-033: renders all six sections from a full fixture", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(fullFixture);
    renderPage("0c8f1a92-d41b");
    await waitFor(() => {
      expect(screen.getByTestId("run-funnel")).toBeTruthy();
    });
    expect(screen.getByTestId("stage-timing-rail")).toBeTruthy();
    expect(screen.getByTestId("cost-strip")).toBeTruthy();
    expect(screen.getByTestId("source-telemetry-table")).toBeTruthy();
    expect(screen.getByTestId("enrichment-strip")).toBeTruthy();
    expect(screen.getByTestId("failures-list")).toBeTruthy();
    expect(screen.getByTestId("debug-timeline")).toBeTruthy();
    expect(screen.getByTestId("live-status-pill")).toBeTruthy();
  });

  it("REQ-034: shows a live pill while the run is non-terminal", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(fullFixture);
    renderPage("0c8f1a92-d41b");
    await waitFor(() => {
      expect(screen.getByTestId("live-status-pill")).toBeTruthy();
    });
    expect(
      screen.getByTestId("live-status-pill").getAttribute("data-live"),
    ).toBe("true");
  });

  it("EDGE-005: legacy run renders source + cost sections and timeline/failures empty states", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(legacyFixture);
    renderPage("legacy-1");
    await waitFor(() => {
      expect(screen.getByTestId("source-telemetry-table")).toBeTruthy();
    });
    expect(screen.getByTestId("cost-strip")).toBeTruthy();
    expect(screen.getByTestId("timeline-empty")).toBeTruthy();
    expect(screen.getByTestId("failures-empty")).toBeTruthy();
  });

  it("REQ-024: renders a not-found state when the run is null", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(null);
    renderPage("missing");
    await waitFor(() => {
      expect(screen.getByTestId("run-not-found")).toBeTruthy();
    });
  });
});
