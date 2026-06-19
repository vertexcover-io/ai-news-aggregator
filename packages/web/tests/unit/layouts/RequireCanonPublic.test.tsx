/**
 * Fix #4: the public Must Read page is gated on the tenant's canon flag. When
 * canon is off a visitor (or a stray deep link) is redirected home instead of
 * seeing a page the tenant has turned off.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { TenantBrandingContext } from "../../../src/hooks/useTenantBranding";
import { RequireCanonPublic } from "../../../src/layouts/RequireCanonPublic";

afterEach(cleanup);

function renderWithCanon(canon: boolean): void {
  const branding: TenantBranding = {
    name: "The Inference",
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoUrl: null,
    flags: { canon },
    isTenantZero: false,
  };
  render(
    <TenantBrandingContext.Provider value={branding}>
      <MemoryRouter initialEntries={["/must-read"]}>
        <Routes>
          <Route element={<RequireCanonPublic />}>
            <Route path="/must-read" element={<div>MUST READ PAGE</div>} />
          </Route>
          <Route path="/" element={<div>HOME PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </TenantBrandingContext.Provider>,
  );
}

describe("RequireCanonPublic", () => {
  it("renders the Must Read page when canon is on", () => {
    renderWithCanon(true);
    expect(screen.getByText("MUST READ PAGE")).toBeTruthy();
  });

  it("redirects home when canon is off", () => {
    renderWithCanon(false);
    expect(screen.getByText("HOME PAGE")).toBeTruthy();
    expect(screen.queryByText("MUST READ PAGE")).toBeNull();
  });
});
