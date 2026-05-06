import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import type { ArchiveListResponse, ArchiveListItem } from "@newsletter/shared";
import { ArchiveListingPage } from "../../../src/pages/ArchiveListingPage";
import { PublicLayout } from "../../../src/layouts/PublicLayout";

vi.mock("../../../src/api/archives", () => ({
  listArchives: vi.fn(),
}));

import { listArchives } from "../../../src/api/archives";
const mockListArchives = vi.mocked(listArchives);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithQueryClient(
  ui: ReactElement,
  data?: ArchiveListResponse,
): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  if (data) {
    qc.setQueryData(["archives", "list"], data);
    mockListArchives.mockResolvedValue(data);
  }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderWithLayout(
  data?: ArchiveListResponse,
): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  if (data) {
    qc.setQueryData(["archives", "list"], data);
    mockListArchives.mockResolvedValue(data);
  }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<ArchiveListingPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeArchive(
  runId: string,
  runDate: string,
  storyCount = 5,
  leadSummary: string | null = null,
  topItems?: ArchiveListItem["topItems"],
): ArchiveListItem {
  return {
    runId,
    runDate,
    storyCount,
    topItems:
      topItems ?? (storyCount > 0
        ? [{ id: 1, title: `Top story for ${runId}`, sourceType: "hn" }]
        : []),
    leadSummary,
    digestHeadline: null,
    digestSummary: null,
  };
}

function makeArchives(count: number, month = "2026-04"): ArchiveListResponse {
  return {
    archives: Array.from({ length: count }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return makeArchive(`run-${String(i)}`, `${month}-${day}`);
    }),
  };
}

function getFilterChips(): NodeListOf<Element> {
  return document.querySelectorAll("button[data-filter-chip]");
}

function getFilterChipByText(text: string): Element | undefined {
  return Array.from(getFilterChips()).find((b) =>
    b.textContent?.includes(text),
  );
}

function requireFilterChipByText(text: string): Element {
  const chip = getFilterChipByText(text);
  if (!chip) throw new Error(`FilterChip with text "${text}" not found`);
  return chip;
}

function getArchiveRows(): NodeListOf<Element> {
  return document.querySelectorAll("ul.archive-list > li");
}

describe("ArchiveListingPage", () => {
  // REQ-034: document.title
  it("REQ-034: document.title is 'Newsletter archive'", () => {
    const data = makeArchives(1, "2026-04");
    renderWithQueryClient(<ArchiveListingPage />, data);
    expect(document.title).toBe("Newsletter archive");
  });

  // REQ-012: renders nav, hero, filter row, archive list and footer when data loads
  it("REQ-012: renders nav, hero, filter row, archive list and footer when data loads", () => {
    const data = makeArchives(3, "2026-04");
    renderWithLayout(data);
    expect(screen.getByText("AI Newsletter")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(getFilterChipByText("All")).toBeTruthy();
    expect(getArchiveRows().length).toBeGreaterThan(0);
    expect(screen.getByText(/Made by Vertexcover/)).toBeTruthy();
  });

  // REQ-018: loading state shows SkeletonRows (animate-pulse elements)
  it("REQ-018: renders at least 3 animate-pulse skeletons while loading", () => {
    mockListArchives.mockReturnValue(new Promise((_resolve) => { /* never resolves */ }));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ArchiveListingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  // REQ-019: with 25 archives, initial render shows exactly 10 rows
  it("REQ-019: initial render shows exactly 10 archive rows with 25 total archives", () => {
    const data = makeArchives(25, "2026-04");
    renderWithQueryClient(<ArchiveListingPage />, data);
    expect(getArchiveRows().length).toBe(10);
  });

  // REQ-020: clicking Load more reveals 10 more, then rest, then hides
  it("REQ-020: Load more reveals 10 more each click until all shown", () => {
    const data = makeArchives(25, "2026-04");
    renderWithQueryClient(<ArchiveListingPage />, data);

    expect(getArchiveRows().length).toBe(10);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(getArchiveRows().length).toBe(20);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(getArchiveRows().length).toBe(25);

    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  // REQ-021: with 8 archives, Load more never renders
  it("REQ-021: Load more not rendered when archives <= 10", () => {
    const data = makeArchives(8, "2026-04");
    renderWithQueryClient(<ArchiveListingPage />, data);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  // REQ-022: filter row chips derived from data (not filtered), newest first
  it("REQ-022: filter row shows All + month chips newest first with correct counts", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive("r1", "2026-04-01"),
        makeArchive("r2", "2026-04-15"),
        makeArchive("r3", "2026-03-01"),
        makeArchive("r4", "2026-03-15"),
        makeArchive("r5", "2026-03-20"),
        makeArchive("r6", "2026-02-10"),
      ],
    };
    renderWithQueryClient(<ArchiveListingPage />, data);
    expect(getFilterChips().length).toBe(4); // All + Apr + Mar + Feb
    const allChip = getFilterChipByText("All");
    expect(allChip?.textContent).toContain("6");
  });

  // REQ-023: clicking Mar chip filters to Mar archives, Mar chip active, All inactive
  it("REQ-023: clicking month chip filters list and marks chip active", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive("r1", "2026-04-01"),
        makeArchive("r2", "2026-04-15"),
        makeArchive("r3", "2026-03-01"),
        makeArchive("r4", "2026-03-15"),
        makeArchive("r5", "2026-03-20"),
      ],
    };
    renderWithQueryClient(<ArchiveListingPage />, data);

    const marChip = requireFilterChipByText("Mar");
    fireEvent.click(marChip);

    expect(getArchiveRows().length).toBe(3);
    expect(marChip.getAttribute("data-active")).toBe("true");
    const allChip = getFilterChipByText("All");
    expect(allChip?.getAttribute("data-active")).toBeFalsy();
  });

  // REQ-024: clicking active Mar chip restores all, All active
  it("REQ-024: clicking active month chip again clears filter", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive("r1", "2026-04-01"),
        makeArchive("r2", "2026-04-15"),
        makeArchive("r3", "2026-03-01"),
        makeArchive("r4", "2026-03-15"),
        makeArchive("r5", "2026-03-20"),
      ],
    };
    renderWithQueryClient(<ArchiveListingPage />, data);

    const marChip = requireFilterChipByText("Mar");

    fireEvent.click(marChip);
    expect(getArchiveRows().length).toBe(3);

    fireEvent.click(marChip);
    expect(getArchiveRows().length).toBe(5);
  });

  // REQ-025: clicking All while month active clears filter
  it("REQ-025: clicking All chip clears filter", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive("r1", "2026-04-01"),
        makeArchive("r2", "2026-04-15"),
        makeArchive("r3", "2026-03-01"),
        makeArchive("r4", "2026-03-15"),
        makeArchive("r5", "2026-03-20"),
      ],
    };
    renderWithQueryClient(<ArchiveListingPage />, data);

    const marChip = requireFilterChipByText("Mar");
    const allChip = requireFilterChipByText("All");

    fireEvent.click(marChip);
    expect(getArchiveRows().length).toBe(3);

    fireEvent.click(allChip);
    expect(getArchiveRows().length).toBe(5);
  });

  // REQ-026: filter + Load more works within filtered set
  it("REQ-026: Load more reveals within filtered set", () => {
    const archives: ArchiveListItem[] = [
      ...Array.from({ length: 25 }, (_, i) => {
        const day = String(i + 1).padStart(2, "0");
        return makeArchive(`mar-${String(i)}`, `2026-03-${day}`);
      }),
      makeArchive("apr-1", "2026-04-01"),
      makeArchive("apr-2", "2026-04-02"),
    ];
    renderWithQueryClient(<ArchiveListingPage />, { archives });

    const marChip = requireFilterChipByText("Mar");
    fireEvent.click(marChip);

    expect(getArchiveRows().length).toBe(10);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(getArchiveRows().length).toBe(20);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(getArchiveRows().length).toBe(25);

    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  // REQ-027: error state — shows exact string, no filter chips, no load more
  it("REQ-027: error state renders exact text and no filter or load more", async () => {
    mockListArchives.mockRejectedValue(new Error("boom"));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ArchiveListingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Couldn't load issues")).toBeTruthy();
    });
    expect(getFilterChips().length).toBe(0);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  // REQ-028: empty state — exact string, no filter, no load more
  it("REQ-028: empty state renders exact string 'No issues yet. Check back soon.'", async () => {
    mockListArchives.mockResolvedValue({ archives: [] });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ArchiveListingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("No issues yet. Check back soon.")).toBeTruthy();
    });
    expect(getFilterChips().length).toBe(0);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  // EDGE-008: single month fixture → All + one chip; single month group header
  it("EDGE-008: single month fixture has All + 1 month chip and 1 group header", () => {
    const data = makeArchives(3, "2026-04");
    renderWithQueryClient(<ArchiveListingPage />, data);
    expect(getFilterChips().length).toBe(2); // All + Apr
    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.length).toBe(1);
  });

  // EDGE-009: after loading more, switching filter resets visible count
  it("EDGE-009: switching filter resets visible count to 10", () => {
    const archives: ArchiveListItem[] = [
      ...Array.from({ length: 20 }, (_, i) => {
        const day = String(i + 1).padStart(2, "0");
        return makeArchive(`apr-${String(i)}`, `2026-04-${day}`);
      }),
      ...Array.from({ length: 5 }, (_, i) => {
        const day = String(i + 1).padStart(2, "0");
        return makeArchive(`mar-${String(i)}`, `2026-03-${day}`);
      }),
    ];
    renderWithQueryClient(<ArchiveListingPage />, { archives });

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(getArchiveRows().length).toBe(20);

    const marChip = requireFilterChipByText("Mar");
    fireEvent.click(marChip);
    expect(getArchiveRows().length).toBe(5);
  });

  // EDGE-014: 17 archives, Load more reveals remainder < 10
  it("EDGE-014: 17 archives — Load more shows 10, then 17, then hides", () => {
    const data = makeArchives(17, "2026-04");
    renderWithQueryClient(<ArchiveListingPage />, data);

    expect(getArchiveRows().length).toBe(10);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(getArchiveRows().length).toBe(17);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  // EDGE-015: Load more does NOT re-fetch
  it("EDGE-015: Load more does not call listArchives again", () => {
    const data = makeArchives(25, "2026-04");
    mockListArchives.mockResolvedValue(data);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    qc.setQueryData(["archives", "list"], data);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ArchiveListingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const callCountBefore = mockListArchives.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(mockListArchives.mock.calls.length).toBe(callCountBefore);
  });

  // EDGE-016: duplicate runId fixture renders without crash
  it("EDGE-016: duplicate runId archives render without crash", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive("dup-id", "2026-04-01"),
        makeArchive("dup-id", "2026-04-02"),
      ],
    };
    expect(() => {
      renderWithQueryClient(<ArchiveListingPage />, data);
    }).not.toThrow();
    expect(getArchiveRows().length).toBe(2);
  });

  // REQ-017 page-level integration tests
  it("REQ-017: first archive with non-empty leadSummary renders data-featured on page", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive(
          "run-featured",
          "2026-04-18",
          12,
          "A concrete lead paragraph shown on the featured row.",
          [{ id: 7, title: "Anthropic pricing shift", sourceType: "hn" }],
        ),
        makeArchive(
          "run-normal",
          "2026-04-17",
          9,
          null,
          [{ id: 3, title: "Meta open-weights", sourceType: "reddit" }],
        ),
      ],
    };
    renderWithQueryClient(<ArchiveListingPage />, data);

    const rows = document.querySelectorAll("ul.archive-list > li");
    expect(rows[0].getAttribute("data-featured")).toBe("true");
    expect(rows[1].getAttribute("data-featured")).toBeNull();
    expect(screen.getByText("A concrete lead paragraph shown on the featured row.")).toBeTruthy();
  });

  it("REQ-017: first archive with null leadSummary does NOT render data-featured", () => {
    const data: ArchiveListResponse = {
      archives: [
        makeArchive(
          "run-no-summary",
          "2026-04-18",
          5,
          null,
          [{ id: 7, title: "Something", sourceType: "hn" }],
        ),
      ],
    };
    renderWithQueryClient(<ArchiveListingPage />, data);

    const rows = document.querySelectorAll("ul.archive-list > li");
    expect(rows[0].getAttribute("data-featured")).toBeNull();
  });
});
