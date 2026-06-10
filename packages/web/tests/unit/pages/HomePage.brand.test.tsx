import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { ResolvedBranding } from "../../../src/context/TenantBrandingContext";
import { HomePage } from "../../../src/pages/HomePage";

vi.mock("../../../src/context/TenantBrandingContext", () => ({
  useBrand: vi.fn(),
}));

vi.mock("../../../src/api/home", () => ({
  getHome: vi.fn(() =>
    Promise.resolve({
      todaysIssue: null,
      featuredCanon: null,
      recentIssues: [],
    }),
  ),
}));

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

vi.mock("../../../src/hooks/useIsSubscribed", () => ({
  useIsSubscribed: vi.fn(() => false),
}));

import { useBrand } from "../../../src/context/TenantBrandingContext";

const mockUseBrand = vi.mocked(useBrand);

function brand(overrides: Partial<ResolvedBranding> = {}): ResolvedBranding {
  return {
    name: "Daily Read",
    headline: "Your daily AI briefing",
    topicStrip: null,
    subtagline: null,
    logoVersion: 0,
    hasLogo: false,
    logoUrl: null,
    nav: { sources: true, mustRead: false, built: false },
    isLoading: false,
    ...overrides,
  };
}

function renderHome(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(ui);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomePage branding", () => {
  it("renders the configured headline, topic strip, and subtagline", () => {
    mockUseBrand.mockReturnValue(
      brand({
        name: "The Inference",
        headline: "The daily read for people building with inference.",
        topicStrip: "SERVING · QUANTIZATION · LATENCY · COST",
        subtagline: "No funding rounds. No leaderboards. Just the runtime.",
      }),
    );
    renderHome();
    expect(
      screen.getByText("The daily read for people building with inference."),
    ).toBeTruthy();
    expect(screen.getByText(/SERVING/)).toBeTruthy();
    expect(screen.getByText(/QUANTIZATION/)).toBeTruthy();
    expect(
      screen.getByText(/No funding rounds\. No leaderboards\. Just the runtime\./),
    ).toBeTruthy();
  });

  it("sets the document title from the tenant name and headline", async () => {
    mockUseBrand.mockReturnValue(
      brand({ name: "The Inference", headline: "Daily inference" }),
    );
    renderHome();
    await waitFor(() => {
      expect(document.title).toBe("The Inference — Daily inference");
    });
  });

  it("falls back to the default topic list when no topic strip is configured", () => {
    mockUseBrand.mockReturnValue(brand({ topicStrip: null }));
    renderHome();
    expect(screen.getByText(/AGENTIC/)).toBeTruthy();
  });
});
