import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResolvedBranding } from "../../../src/context/TenantBrandingContext";
import { Footer } from "../../../src/components/shell/Footer";

vi.mock("../../../src/context/TenantBrandingContext", () => ({
  useBrand: vi.fn(),
}));

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
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

function renderFooter(path = "/"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Footer />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Footer", () => {
  it("renders the tenant name in the brand block and copyright", () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderFooter();
    expect(screen.getAllByText("The Inference").length).toBeGreaterThan(0);
    expect(screen.getByText(/©/)).toBeTruthy();
  });

  it("omits the colophon and Vertexcover attribution for non-tenant-0", () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderFooter();
    expect(screen.queryByText(/is built by agents/i)).toBeNull();
    expect(screen.queryByText(/Vertexcover Labs/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /how it's built/i })).toBeNull();
  });

  it("shows the colophon, canon link and built link for tenant 0", () => {
    mockUseBrand.mockReturnValue(
      brand({
        name: "AGENTLOOP",
        nav: { sources: true, mustRead: true, built: true },
      }),
    );
    renderFooter();
    expect(screen.getByText(/is built by agents/i)).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /how it's built/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /must read/i })).toBeTruthy();
    expect(screen.getAllByText(/Vertexcover Labs/i).length).toBeGreaterThan(0);
  });

  it("hides the colophon on the /built route even for tenant 0", () => {
    mockUseBrand.mockReturnValue(
      brand({
        name: "AGENTLOOP",
        nav: { sources: true, mustRead: true, built: true },
      }),
    );
    renderFooter("/built");
    expect(screen.queryByText(/is built by agents/i)).toBeNull();
  });

  it("hides the Must Read footer link when canon is off", () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderFooter();
    expect(screen.queryByRole("link", { name: /must read/i })).toBeNull();
    expect(screen.getByRole("link", { name: /sources/i })).toBeTruthy();
  });
});
