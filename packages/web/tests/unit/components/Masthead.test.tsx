import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResolvedBranding } from "../../../src/context/TenantBrandingContext";
import { Masthead } from "../../../src/components/shell/Masthead";

vi.mock("../../../src/context/TenantBrandingContext", () => ({
  useBrand: vi.fn(),
}));

vi.mock("../../../src/hooks/useAdminSession", () => ({
  useAdminSession: vi.fn(() => ({ data: undefined })),
}));

import { useBrand } from "../../../src/context/TenantBrandingContext";
import { useAdminSession } from "../../../src/hooks/useAdminSession";

const mockUseBrand = vi.mocked(useBrand);
const mockUseAdminSession = vi.mocked(useAdminSession);

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

function renderMast(): void {
  render(
    <MemoryRouter>
      <Masthead />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseAdminSession.mockReturnValue({
    data: undefined,
  } as ReturnType<typeof useAdminSession>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Masthead", () => {
  it("renders the configured tenant name as the wordmark", () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderMast();
    expect(screen.getByText("The Inference")).toBeTruthy();
    expect(screen.queryByText("AGENTLOOP")).toBeNull();
  });

  it("shows only Sources in nav when canon and built are off", () => {
    mockUseBrand.mockReturnValue(
      brand({ nav: { sources: true, mustRead: false, built: false } }),
    );
    renderMast();
    expect(screen.getByRole("link", { name: /sources/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /must read/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /how it's built/i })).toBeNull();
  });

  it("shows Must Read when canon is on", () => {
    mockUseBrand.mockReturnValue(
      brand({ nav: { sources: true, mustRead: true, built: false } }),
    );
    renderMast();
    expect(screen.getByRole("link", { name: /must read/i })).toBeTruthy();
  });

  it("shows How it's built and the Vertexcover publication line only for tenant 0", () => {
    mockUseBrand.mockReturnValue(
      brand({
        name: "AGENTLOOP",
        nav: { sources: true, mustRead: true, built: true },
      }),
    );
    renderMast();
    expect(screen.getByRole("link", { name: /how it's built/i })).toBeTruthy();
    expect(screen.getByText(/Vertexcover Labs/i)).toBeTruthy();
  });

  it("hides the Vertexcover publication line for non-tenant-0", () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderMast();
    expect(screen.queryByText(/Vertexcover Labs/i)).toBeNull();
  });

  it("renders the tenant logo image when a logoUrl is present", () => {
    mockUseBrand.mockReturnValue(
      brand({ name: "The Inference", hasLogo: true, logoUrl: "/api/tenant/logo?v=2" }),
    );
    renderMast();
    const img = screen.getByAltText("The Inference");
    expect(img.getAttribute("src")).toBe("/api/tenant/logo?v=2");
  });
});
