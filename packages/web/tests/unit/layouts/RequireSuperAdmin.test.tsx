/**
 * P15: RequireSuperAdmin gate — the tenant-list console is super_admin only
 * (REQ-100). A tenant_admin never sees it: the guard bounces them to their
 * own dashboard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthMeResponse } from "@newsletter/shared/types/tenant";
import { RequireSuperAdmin } from "../../../src/layouts/RequireSuperAdmin";

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

function makeSession(role: "super_admin" | "tenant_admin"): AuthMeResponse {
  return role === "super_admin"
    ? {
        user: { id: "su", tenantId: null, email: "s@a.c", name: "S", role },
        tenant: null,
        impersonation: null,
      }
    : {
        user: { id: "u1", tenantId: "t1", email: "a@b.c", name: "A", role },
        tenant: { id: "t1", slug: "t", name: "T", status: "active" },
      };
}

function renderConsoleRoute(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/tenants"]}>
        <Routes>
          <Route element={<RequireSuperAdmin />}>
            <Route
              path="/admin/tenants"
              element={<div>CONSOLE SURFACE</div>}
            />
          </Route>
          <Route path="/admin" element={<div>DASHBOARD SURFACE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireSuperAdmin", () => {
  it("super_admin → console renders", async () => {
    mockFetchMe.mockResolvedValue(makeSession("super_admin"));
    renderConsoleRoute();
    expect(await screen.findByText("CONSOLE SURFACE")).toBeTruthy();
  });

  it("tenant_admin → redirected away, console never renders (REQ-100 guard)", async () => {
    mockFetchMe.mockResolvedValue(makeSession("tenant_admin"));
    renderConsoleRoute();
    expect(await screen.findByText("DASHBOARD SURFACE")).toBeTruthy();
    expect(screen.queryByText("CONSOLE SURFACE")).toBeNull();
  });
});
