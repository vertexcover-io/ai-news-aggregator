import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type {
  SourcesSummaryResponse,
  SourcesSummaryRow,
  SourcesSummarySection,
} from "@newsletter/shared/types";
import { SourcesPage } from "../../../src/pages/SourcesPage";

vi.mock("../../../src/api/sources", () => ({
  fetchSourcesSummary: vi.fn(),
}));

import { fetchSourcesSummary } from "../../../src/api/sources";
const mockFetch = vi.mocked(fetchSourcesSummary);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockFetch.mockReset();
});

function makeRow(overrides: Partial<SourcesSummaryRow> = {}): SourcesSummaryRow {
  return {
    identifier: "example",
    displayName: "Example",
    url: "https://example.com",
    todayCount: 0,
    weekCount: 0,
    inDigestCount: 0,
    status: "healthy",
    lastFetchedAt: null,
    ...overrides,
  };
}

function makeSection(
  sourceType: SourcesSummarySection["sourceType"],
  rows: SourcesSummaryRow[],
): SourcesSummarySection {
  return { sourceType, rows };
}

function renderPage(data: SourcesSummaryResponse): ReturnType<typeof render> {
  mockFetch.mockResolvedValue(data);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/sources"]}>
        <SourcesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SourcesPage", () => {
  it("renders the page headline", async () => {
    renderPage({
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [],
      rankingPrompt: "PROMPT",
    });
    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "The reading list behind the newsletter.",
        }),
      ).toBeTruthy();
    });
  });

  it("renders sections in SOURCE_TYPE_ORDER", async () => {
    const data: SourcesSummaryResponse = {
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [
        makeSection("blog", [makeRow({ identifier: "anthropic.com", displayName: "Anthropic" })]),
        makeSection("hn", [makeRow({ identifier: "news.ycombinator.com", displayName: "HN" })]),
        makeSection("reddit", [makeRow({ identifier: "r/LocalLLaMA", displayName: "r/LocalLLaMA" })]),
      ],
      rankingPrompt: "PROMPT",
    };
    renderPage(data);
    await waitFor(() => {
      expect(screen.getByText("HN")).toBeTruthy();
    });
    const headings = screen.getAllByRole("heading", { level: 2 });
    const titles = headings.map((h) => h.textContent);
    const hnIdx = titles.indexOf("Hacker News");
    const redditIdx = titles.indexOf("Reddit");
    const blogIdx = titles.indexOf("Engineering Blogs");
    expect(hnIdx).toBeGreaterThanOrEqual(0);
    expect(hnIdx).toBeLessThan(redditIdx);
    expect(redditIdx).toBeLessThan(blogIdx);
  });

  it("hides sections that have no rows", async () => {
    const data: SourcesSummaryResponse = {
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [
        makeSection("hn", [makeRow({ displayName: "HN" })]),
        makeSection("reddit", []),
      ],
      rankingPrompt: "PROMPT",
    };
    renderPage(data);
    await waitFor(() => {
      expect(screen.getByText("HN")).toBeTruthy();
    });
    expect(screen.queryByText("Reddit")).toBeNull();
  });

  it("sorts rows by todayCount descending within a section", async () => {
    const data: SourcesSummaryResponse = {
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [
        makeSection("reddit", [
          makeRow({ identifier: "r/LocalLLaMA", displayName: "r/LocalLLaMA", todayCount: 3 }),
          makeRow({ identifier: "r/MachineLearning", displayName: "r/MachineLearning", todayCount: 5 }),
          makeRow({ identifier: "r/singularity", displayName: "r/singularity", todayCount: 1 }),
        ]),
      ],
      rankingPrompt: "PROMPT",
    };
    renderPage(data);
    await waitFor(() => {
      expect(screen.getByText("r/MachineLearning")).toBeTruthy();
    });
    const rows = document.querySelectorAll('[data-source-row="true"]');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain("r/MachineLearning");
    expect(rows[1].textContent).toContain("r/LocalLLaMA");
    expect(rows[2].textContent).toContain("r/singularity");
  });

  it("renders status glyphs with the correct aria-label", async () => {
    const data: SourcesSummaryResponse = {
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [
        makeSection("hn", [
          makeRow({ identifier: "a", displayName: "Healthy Source", status: "healthy" }),
          makeRow({ identifier: "b", displayName: "Idle Source", status: "idle" }),
          makeRow({ identifier: "c", displayName: "Failing Source", status: "failing" }),
        ]),
      ],
      rankingPrompt: "PROMPT",
    };
    renderPage(data);
    await waitFor(() => {
      expect(screen.getByLabelText("Healthy")).toBeTruthy();
    });
    expect(screen.getByLabelText("Idle")).toBeTruthy();
    expect(screen.getByLabelText("Failing")).toBeTruthy();
  });

  it("renders the rankingPrompt verbatim", async () => {
    const prompt = "You are a ranker.\nRank by Novelty, Signal, Actionability.\nReturn JSON.";
    renderPage({
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [],
      rankingPrompt: prompt,
    });
    await waitFor(() => {
      expect(screen.getByText(/You are a ranker/)).toBeTruthy();
    });
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(prompt);
  });

  it("renders displayName from response, not identifier when both differ", async () => {
    const data: SourcesSummaryResponse = {
      generatedAt: "2026-05-23T12:00:00Z",
      sections: [
        makeSection("blog", [
          makeRow({
            identifier: "anthropic.com",
            displayName: "Anthropic Engineering",
          }),
        ]),
      ],
      rankingPrompt: "PROMPT",
    };
    renderPage(data);
    await waitFor(() => {
      expect(screen.getByText("Anthropic Engineering")).toBeTruthy();
    });
    expect(screen.queryByText("anthropic.com")).toBeNull();
  });
});
