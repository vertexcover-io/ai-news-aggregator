import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantListPage } from "../../../src/pages/admin/TenantListPage";
import {
  impersonateTenant,
  listTenants,
  type SuperAdminTenant,
} from "../../../src/api/superAdmin";

vi.mock("../../../src/api/superAdmin", () => ({
  listTenants: vi.fn(),
  impersonateTenant: vi.fn(),
}));

const listMock = vi.mocked(listTenants);
const impersonateMock = vi.mocked(impersonateTenant);

const TENANTS: SuperAdminTenant[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "agentloop",
    name: "AGENTLOOP",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    slug: "pending-ab12cd34",
    name: "GreenChip",
    status: "pending_setup",
    createdAt: "2026-02-01T00:00:00.000Z",
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/tenants"]}>
        <Routes>
          <Route path="/admin/tenants" element={<TenantListPage />} />
          <Route path="/admin" element={<div>tenant dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TenantListPage (REQ-100/101)", () => {
  it("renders every tenant with name, slug, and status badge", async () => {
    listMock.mockResolvedValue(TENANTS);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeTruthy();
    });
    expect(screen.getByText("agentloop")).toBeTruthy();
    expect(screen.getByText("GreenChip")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("In setup")).toBeTruthy();
    expect(screen.getByText(/2 total · 1 active · 1 in setup/)).toBeTruthy();
  });

  it("Open calls the impersonate endpoint with the tenant id and lands on the dashboard", async () => {
    listMock.mockResolvedValue(TENANTS);
    impersonateMock.mockResolvedValue({
      impersonating: true,
      tenant: {
        id: TENANTS[0].id,
        slug: "agentloop",
        name: "AGENTLOOP",
        status: "active",
      },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeTruthy();
    });
    const openButtons = screen.getAllByRole("button", { name: /open/i });
    fireEvent.click(openButtons[0]);

    await waitFor(() => {
      expect(impersonateMock).toHaveBeenCalledTimes(1);
      expect(impersonateMock.mock.calls[0][0]).toBe(TENANTS[0].id);
      expect(screen.getByText("tenant dashboard")).toBeTruthy();
    });
  });

  it("shows an error state when the list fails", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load tenants/i)).toBeTruthy();
    });
  });
});
