import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SourcesSummaryResponse } from "@newsletter/shared/types";
import { AnalyticsPage } from "../../../src/pages/AnalyticsPage";

vi.mock("../../../src/api/sources", () => ({
  fetchSourcesSummary: vi.fn(),
}));
vi.mock("../../../src/api/analytics", () => ({
  fetchAnalytics: vi.fn(() =>
    Promise.resolve({
      totalSubscriptions: 0,
      totalUnsubscriptions: 0,
      emailsSent: 0,
      bounces: 0,
      complaints: 0,
      opens: 0,
      clicks: 0,
    }),
  ),
}));
vi.mock("../../../src/api/notifications", () => ({
  getFeatureFlags: vi.fn(),
}));

import { fetchSourcesSummary } from "../../../src/api/sources";
import { getFeatureFlags } from "../../../src/api/notifications";
const mockFetchSources = vi.mocked(fetchSourcesSummary);
const mockGetFeatureFlags = vi.mocked(getFeatureFlags);

function flags(deliverability: boolean): {
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
} {
  return {
    featureCanon: false,
    featureDeliverability: deliverability,
    featureEval: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockFetchSources.mockReset();
  // Default: Deliverability enabled so the existing tab tests render metrics.
  mockGetFeatureFlags.mockResolvedValue(flags(true));
});

function makeSourcesResponse(): SourcesSummaryResponse {
  return {
    generatedAt: "2026-05-23T12:00:00Z",
    range: {
      from: "2026-05-16T12:00:00.000Z",
      to: "2026-05-23T12:00:00.000Z",
      runsInRange: 2,
    },
    sections: [
      {
        sourceType: "hn",
        rows: [
          {
            identifier: "news.ycombinator.com",
            displayName: "Hacker News",
            url: "https://news.ycombinator.com",
            fetchedCount: 10,
            usedCount: 2,
            failureCount: 0,
            lastFailureMessage: null,
          },
        ],
      },
      {
        sourceType: "reddit",
        rows: [
          {
            identifier: "r/MachineLearning",
            displayName: "r/MachineLearning",
            url: "https://reddit.com/r/MachineLearning",
            fetchedCount: 5,
            usedCount: 0,
            failureCount: 3,
            lastFailureMessage: "RSS 403",
          },
        ],
      },
    ],
    configured: [],
    failures: [
      {
        sourceType: "reddit",
        identifier: "r/MachineLearning",
        displayName: "r/MachineLearning",
        runsAffected: 3,
        lastErrorMessage: "RSS 403",
        lastFailedAt: "2026-05-22T04:50:00.000Z",
      },
    ],
    rankingPrompt: "PROMPT",
  };
}

function renderAnalytics(initialUrl = "/admin/analytics"): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <AnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AnalyticsPage tabs", () => {
  it("defaults to Deliverability tab", async () => {
    renderAnalytics();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /deliverability/i })).toBeTruthy();
    });
    const deliv = screen.getByRole("tab", { name: /deliverability/i });
    const sources = screen.getByRole("tab", { name: /sources/i });
    expect(deliv.getAttribute("aria-selected")).toBe("true");
    expect(sources.getAttribute("aria-selected")).toBe("false");
  });

  it("switches to Sources tab via click and shows range strip", async () => {
    mockFetchSources.mockResolvedValue(makeSourcesResponse());
    renderAnalytics();
    fireEvent.click(screen.getByRole("tab", { name: /sources/i }));
    await waitFor(() => {
      expect(screen.getAllByText("Hacker News").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Total fetched/i)).toBeTruthy();
    // Range strip's "RANGE" label is one of the controls
    expect(screen.getAllByText(/Range/i).length).toBeGreaterThan(0);
  });

  it("respects ?tab=sources in URL on initial render", async () => {
    mockFetchSources.mockResolvedValue(makeSourcesResponse());
    renderAnalytics("/admin/analytics?tab=sources");
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /sources/i }).getAttribute("aria-selected"),
      ).toBe("true");
    });
  });

  it("renders error strip and FAILING badge when failures present", async () => {
    mockFetchSources.mockResolvedValue(makeSourcesResponse());
    renderAnalytics("/admin/analytics?tab=sources");
    await waitFor(() => {
      expect(screen.getByText("Failing")).toBeTruthy();
    });
    expect(screen.getByText(/Failures · in range/i)).toBeTruthy();
    expect(screen.getAllByText(/RSS 403/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 runs/i).length).toBeGreaterThan(0);
  });

  // Fix #4: Deliverability is flag-gated. When off, its tab shows the disabled
  // notice instead of metrics; the Sources tab is unaffected.
  it("shows the disabled notice on the Deliverability tab when the flag is off", async () => {
    mockGetFeatureFlags.mockResolvedValue(flags(false));
    renderAnalytics();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /enable in settings/i }).getAttribute("href"),
    ).toBe("/admin/settings");
  });

  it("keeps the Sources tab working when Deliverability is off", async () => {
    mockGetFeatureFlags.mockResolvedValue(flags(false));
    mockFetchSources.mockResolvedValue(makeSourcesResponse());
    renderAnalytics();
    await screen.findByText(/Deliverability analytics is currently disabled/i);
    fireEvent.click(screen.getByRole("tab", { name: /sources/i }));
    await waitFor(() => {
      expect(screen.getAllByText("Hacker News").length).toBeGreaterThan(0);
    });
    // The deliverability disabled notice is gone; Sources renders normally.
    expect(
      screen.queryByText(/Deliverability analytics is currently disabled/i),
    ).toBeNull();
  });
});
