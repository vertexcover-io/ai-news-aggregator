import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResolvedBranding } from "../../../src/context/TenantBrandingContext";
import { NotFoundPage } from "../../../src/pages/NotFoundPage";

vi.mock("../../../src/context/TenantBrandingContext", () => ({
  useBrand: vi.fn(),
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

function renderNotFound(): void {
  render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotFoundPage branding", () => {
  it("only shows the Today's issue link when canon and built are off", () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderNotFound();
    expect(screen.getByRole("link", { name: /today's issue/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /the canon/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /how it's built/i })).toBeNull();
  });

  it("shows canon and built links for tenant 0", () => {
    mockUseBrand.mockReturnValue(
      brand({ nav: { sources: true, mustRead: true, built: true } }),
    );
    renderNotFound();
    expect(screen.getByRole("link", { name: /the canon/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /how it's built/i })).toBeTruthy();
  });

  it("sets the document title from the tenant name", async () => {
    mockUseBrand.mockReturnValue(brand({ name: "The Inference" }));
    renderNotFound();
    await waitFor(() => {
      expect(document.title).toBe("Not found — The Inference");
    });
  });
});
