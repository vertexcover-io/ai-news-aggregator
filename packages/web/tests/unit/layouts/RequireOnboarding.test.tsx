/**
 * P11: RequireOnboarding gate — pending_setup tenants are funnelled into the
 * wizard; active tenants can't re-enter it (REQ-030/035 routing side).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type { AuthMeResponse } from "@newsletter/shared/types/tenant";
import { RequireOnboarding } from "../../../src/layouts/RequireOnboarding";

vi.mock("../../../src/api/auth", () => ({
  fetchMe: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

import { fetchMe } from "../../../src/api/auth";
const mockFetchMe = vi.mocked(fetchMe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeSession(status: "pending_setup" | "active"): AuthMeResponse {
  return {
    user: {
      id: "u1",
      tenantId: "t1",
      email: "a@b.c",
      name: "A",
      role: "tenant_admin",
    },
    tenant: { id: "t1", slug: "pending-x", name: "A", status },
  };
}

function renderAt(path: string): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<RequireOnboarding />}>
            <Route
              path="/admin/onboarding"
              element={<div>WIZARD SURFACE</div>}
            />
            <Route element={<Outlet />}>
              <Route path="/admin" element={<div>DASHBOARD SURFACE</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireOnboarding", () => {
  it("pending_setup on /admin → redirected into the wizard", async () => {
    mockFetchMe.mockResolvedValue(makeSession("pending_setup"));
    renderAt("/admin");
    expect(await screen.findByText("WIZARD SURFACE")).toBeTruthy();
    expect(screen.queryByText("DASHBOARD SURFACE")).toBeNull();
  });

  it("active tenant on /admin/onboarding → redirected to the dashboard", async () => {
    mockFetchMe.mockResolvedValue(makeSession("active"));
    renderAt("/admin/onboarding");
    expect(await screen.findByText("DASHBOARD SURFACE")).toBeTruthy();
    expect(screen.queryByText("WIZARD SURFACE")).toBeNull();
  });

  it("active tenant on /admin → passes through", async () => {
    mockFetchMe.mockResolvedValue(makeSession("active"));
    renderAt("/admin");
    expect(await screen.findByText("DASHBOARD SURFACE")).toBeTruthy();
  });

  it("super_admin (no tenant) → passes through untouched", async () => {
    mockFetchMe.mockResolvedValue({
      user: {
        id: "su",
        tenantId: null,
        email: "s@a.c",
        name: "S",
        role: "super_admin",
      },
      tenant: null,
    });
    renderAt("/admin");
    expect(await screen.findByText("DASHBOARD SURFACE")).toBeTruthy();
  });
});
