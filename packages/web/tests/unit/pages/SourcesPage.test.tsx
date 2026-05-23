import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type {
  ConfiguredSection,
  SourcesSummaryResponse,
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

function makeResponse(
  configured: ConfiguredSection[],
): SourcesSummaryResponse {
  return {
    generatedAt: "2026-05-23T12:00:00Z",
    range: {
      from: "2026-05-16T12:00:00Z",
      to: "2026-05-23T12:00:00Z",
      runsInRange: 0,
    },
    sections: [],
    configured,
    failures: [],
    rankingPrompt: "PROMPT",
  };
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

describe("SourcesPage (public)", () => {
  it("renders the page headline", async () => {
    renderPage(makeResponse([]));
    await waitFor(() => {
      expect(
        screen.getByText("The reading list behind the newsletter."),
      ).toBeTruthy();
    });
  });

  it("renders each configured section with rows", async () => {
    renderPage(
      makeResponse([
        {
          sourceType: "hn",
          rows: [
            {
              identifier: "news.ycombinator.com",
              displayName: "Hacker News",
              url: "https://news.ycombinator.com",
            },
          ],
        },
        {
          sourceType: "reddit",
          rows: [
            {
              identifier: "r/LocalLLaMA",
              displayName: "r/LocalLLaMA",
              url: "https://reddit.com/r/LocalLLaMA",
            },
          ],
        },
      ]),
    );
    await waitFor(() => {
      expect(screen.getAllByText("Hacker News").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("r/LocalLLaMA")).toBeTruthy();
    expect(screen.getByText("Reddit")).toBeTruthy();
  });

  it("renders web_search rows in italics with 'via Tavily' label", async () => {
    renderPage(
      makeResponse([
        {
          sourceType: "web_search",
          rows: [
            {
              identifier: "",
              displayName: '"harness engineering"',
              url: null,
            },
          ],
        },
      ]),
    );
    await waitFor(() => {
      expect(screen.getByText('"harness engineering"')).toBeTruthy();
    });
    expect(screen.getByText("via Tavily")).toBeTruthy();
  });

  it("uses the URL when row.url is set", async () => {
    renderPage(
      makeResponse([
        {
          sourceType: "blog",
          rows: [
            {
              identifier: "anthropic.com",
              displayName: "Anthropic",
              url: "https://www.anthropic.com/news",
            },
          ],
        },
      ]),
    );
    await waitFor(() => {
      expect(screen.getByText("Anthropic")).toBeTruthy();
    });
    const link = screen.getByText("Anthropic").closest("a");
    expect(link?.getAttribute("href")).toBe("https://www.anthropic.com/news");
  });

  it("falls back to a plain span when row.url is null", async () => {
    renderPage(
      makeResponse([
        {
          sourceType: "web_search",
          rows: [
            { identifier: "", displayName: '"my topic"', url: null },
          ],
        },
      ]),
    );
    await waitFor(() => {
      expect(screen.getByText('"my topic"')).toBeTruthy();
    });
    expect(screen.getByText('"my topic"').closest("a")).toBeNull();
  });

  it("renders the source count line", async () => {
    renderPage(
      makeResponse([
        {
          sourceType: "hn",
          rows: [
            {
              identifier: "news.ycombinator.com",
              displayName: "Hacker News",
              url: "https://news.ycombinator.com",
            },
          ],
        },
        {
          sourceType: "reddit",
          rows: [
            {
              identifier: "r/A",
              displayName: "r/A",
              url: "https://reddit.com/r/A",
            },
            {
              identifier: "r/B",
              displayName: "r/B",
              url: "https://reddit.com/r/B",
            },
          ],
        },
      ]),
    );
    await waitFor(() => {
      expect(screen.getByText("3 sources")).toBeTruthy();
    });
    expect(screen.getByText("2 categories")).toBeTruthy();
  });

  it("renders the How we pick footer", async () => {
    renderPage(makeResponse([]));
    await waitFor(() => {
      expect(screen.getByText("How we pick")).toBeTruthy();
    });
  });
});
