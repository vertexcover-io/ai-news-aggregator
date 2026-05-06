import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { ArchivePage } from "../../../src/pages/ArchivePage";
import type { RunStateResponse } from "../../../src/api/runs";

vi.mock("../../../src/hooks/useArchive", () => ({
  useArchive: vi.fn(),
}));

import { useArchive } from "../../../src/hooks/useArchive";

type UseArchiveReturn = ReturnType<typeof useArchive>;

function makeResult(
  data: RunStateResponse | null,
  isLoading = false,
  isError = false,
): UseArchiveReturn {
  return { data, isLoading, isError } as UseArchiveReturn;
}

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/archive/abc"]}>
        <Routes>
          <Route path="/archive/:runId" element={<ArchivePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(() => {
  document.head.querySelectorAll("meta").forEach((m) => {
    m.remove();
  });
  document.title = "";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const completedData: RunStateResponse = {
  id: "abc",
  status: "completed",
  stage: "completed",
  topN: 5,
  startedAt: "2026-05-06T12:00:00.000Z",
  updatedAt: "2026-05-06T12:00:00.000Z",
  completedAt: "2026-05-06T12:00:00.000Z",
  sources: {},
  rankedItems: [],
  warnings: [],
  error: null,
};

describe("ArchivePage — share metadata + share row (REQ-002, REQ-005, REQ-010, REQ-016)", () => {
  it("sets document.title and og:title for completed status", async () => {
    vi.mocked(useArchive).mockReturnValue(makeResult(completedData));
    renderPage();
    await waitFor(() => {
      expect(document.title).toBe("AI news - May 6, 2026");
    });
    const og = document.head.querySelector('meta[property="og:title"]');
    expect(og?.getAttribute("content")).toBe("AI news - May 6, 2026");
  });

  it("renders exactly one archive-share-row on completed status", async () => {
    vi.mocked(useArchive).mockReturnValue(makeResult(completedData));
    const { container } = renderPage();
    await waitFor(() => {
      expect(
        container.querySelectorAll('[data-testid="archive-share-row"]').length,
      ).toBe(1);
    });
  });

  it("does NOT render share row when loading", () => {
    vi.mocked(useArchive).mockReturnValue(makeResult(null, true, false));
    const { container } = renderPage();
    expect(
      container.querySelectorAll('[data-testid="archive-share-row"]').length,
    ).toBe(0);
  });

  it("does NOT render share row for cancelled status", () => {
    vi.mocked(useArchive).mockReturnValue(
      makeResult({ ...completedData, status: "cancelled" }),
    );
    const { container } = renderPage();
    expect(
      container.querySelectorAll('[data-testid="archive-share-row"]').length,
    ).toBe(0);
  });

  it("does NOT render share row for in-progress status", () => {
    vi.mocked(useArchive).mockReturnValue(
      makeResult({ ...completedData, status: "running" }),
    );
    const { container } = renderPage();
    expect(
      container.querySelectorAll('[data-testid="archive-share-row"]').length,
    ).toBe(0);
  });

  it("does NOT render share row on error", () => {
    vi.mocked(useArchive).mockReturnValue(makeResult(null, false, true));
    const { container } = renderPage();
    expect(
      container.querySelectorAll('[data-testid="archive-share-row"]').length,
    ).toBe(0);
  });
});
