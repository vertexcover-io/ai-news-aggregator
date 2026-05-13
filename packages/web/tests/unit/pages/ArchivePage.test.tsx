import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { ArchivePage } from "../../../src/pages/ArchivePage";
import type { RunStateResponse } from "../../../src/api/runs";
import type { RankedItem } from "@newsletter/shared";

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

function makeRankedItem(overrides: Partial<RankedItem> = {}): RankedItem {
  return {
    id: 1,
    rawItemId: 1,
    title: "Recursive Self-Improvement Launches in London and SF",
    url: "https://example.com/story",
    sourceType: "hn",
    author: "author",
    publishedAt: "2026-05-06T11:00:00.000Z",
    engagement: { points: 10, commentCount: 2 },
    score: 99,
    rationale: "Important because it is the lead story.",
    content: null,
    imageUrl: null,
    recap: {
      title: "Recursive Self-Improvement Launches in London and SF",
      summary: "A new AI lab launched around systems that can improve their own research process.",
      bullets: ["The team is split between London and San Francisco."],
      bottomLine: "This is the issue's lead story.",
    },
    ...overrides,
  };
}

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

  it("uses the first story title for document.title and og:title when digestHeadline differs", async () => {
    vi.mocked(useArchive).mockReturnValue(
      makeResult({
        ...completedData,
        rankedItems: [makeRankedItem()],
        digestHeadline: "Cactus Distills Gemini Tool Calling into 26M Model",
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(document.title).toBe("Recursive Self-Improvement Launches in London and SF");
    });
    const og = document.head.querySelector('meta[property="og:title"]');
    expect(og?.getAttribute("content")).toBe(
      "Recursive Self-Improvement Launches in London and SF",
    );
  });

  it("passes the first story title as shareText so X composer prefills the heading", async () => {
    vi.mocked(useArchive).mockReturnValue(
      makeResult({
        ...completedData,
        rankedItems: [makeRankedItem()],
        digestHeadline: "Cactus Distills Gemini Tool Calling into 26M Model",
      }),
    );
    const { container } = renderPage();
    await waitFor(() => {
      const xLink = container.querySelector('a[data-share-target="x"]');
      expect(xLink).not.toBeNull();
      const href = xLink?.getAttribute("href") ?? "";
      const m = /text=([^&]+)/.exec(href);
      expect(m).not.toBeNull();
      expect(decodeURIComponent(m?.[1] ?? "")).toBe(
        "Recursive Self-Improvement Launches in London and SF",
      );
    });
  });

  it("uses the first story title as heading and digestSummary as the header dek", async () => {
    vi.mocked(useArchive).mockReturnValue(
      makeResult({
        ...completedData,
        rankedItems: [makeRankedItem()],
        digestHeadline: "Cactus Distills Gemini Tool Calling into 26M Model",
        digestSummary: "Plus: Recursive Self-Improvement launches in London.",
      }),
    );
    const { container, findByText, findAllByText } = renderPage();
    expect(
      await findByText("Plus: Recursive Self-Improvement launches in London."),
    ).toBeTruthy();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Recursive Self-Improvement Launches in London and SF",
    );
    expect(
      await findAllByText(
        "A new AI lab launched around systems that can improve their own research process.",
      ),
    ).toHaveLength(1);
  });

  it("falls back to 'AI news - <Date>' shareText when digestHeadline is null", async () => {
    vi.mocked(useArchive).mockReturnValue(
      makeResult({ ...completedData, digestHeadline: null }),
    );
    const { container } = renderPage();
    await waitFor(() => {
      const xLink = container.querySelector('a[data-share-target="x"]');
      const href = xLink?.getAttribute("href") ?? "";
      const m = /text=([^&]+)/.exec(href);
      expect(decodeURIComponent(m?.[1] ?? "")).toBe("AI news - May 6, 2026");
    });
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
