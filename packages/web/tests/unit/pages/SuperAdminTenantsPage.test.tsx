/**
 * P15: super-admin tenant-list console (REQ-100). Rendering of the list
 * fields (name, owner email, slug, status, subscribers, last run) + the
 * search/status filtering the e2e journey doesn't cover. The full
 * login → list → open → impersonation journey lives in
 * tests/e2e/super-admin-console.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SuperAdminTenantsPage } from "../../../src/pages/SuperAdminTenantsPage";
import type { SuperTenantSummary } from "../../../src/api/super";

vi.mock("../../../src/api/super", () => ({
  listTenants: vi.fn(),
  impersonateTenant: vi.fn(),
}));

vi.mock("../../../src/api/auth", () => ({
  logout: vi.fn(),
}));

import { listTenants } from "../../../src/api/super";
const mockListTenants = vi.mocked(listTenants);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TENANTS: SuperTenantSummary[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "the-inference",
    name: "The Inference",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ownerEmail: "ada@studio.com",
    subscriberCount: 8210,
    lastRunAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "greenchip",
    name: "GreenChip",
    status: "pending_setup",
    createdAt: "2026-02-01T00:00:00.000Z",
    ownerEmail: "sam@greenchip.energy",
    subscriberCount: 0,
    lastRunAt: null,
  },
];

function renderPage(): void {
  mockListTenants.mockResolvedValue(TENANTS);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/tenants"]}>
        <SuperAdminTenantsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SuperAdminTenantsPage", () => {
  it("renders every tenant with owner email, slug, status, subscribers, last run + stats", async () => {
    renderPage();

    const agentloopRow = (await screen.findByText("The Inference")).closest("tr");
    expect(agentloopRow).not.toBeNull();
    if (agentloopRow === null) throw new Error("row missing");
    expect(within(agentloopRow).getByText("ada@studio.com")).toBeTruthy();
    expect(within(agentloopRow).getByText("the-inference")).toBeTruthy();
    expect(within(agentloopRow).getByText("Active")).toBeTruthy();
    expect(within(agentloopRow).getByText("8,210")).toBeTruthy();
    expect(within(agentloopRow).getByText(/ago/)).toBeTruthy();

    // A tenant that never ran degrades to em-dashes, status "In setup".
    const greenchipRow = screen.getByText("GreenChip").closest("tr");
    if (greenchipRow === null) throw new Error("row missing");
    expect(within(greenchipRow).getByText("In setup")).toBeTruthy();
    expect(within(greenchipRow).getAllByText("—").length).toBeGreaterThan(0);

    // Stats strip: total / active / in setup / subscribers.
    expect(screen.getByTestId("stat-total").textContent).toBe("2");
    expect(screen.getByTestId("stat-active").textContent).toBe("1");
    expect(screen.getByTestId("stat-setup").textContent).toBe("1");
    expect(screen.getByTestId("stat-subscribers").textContent).toBe("8,210");
  });

  it("search and status filter narrow the list", async () => {
    renderPage();
    await screen.findByText("The Inference");

    // Search by owner email fragment.
    const search = screen.getByPlaceholderText(/Search tenants/i);
    fireEvent.change(search, { target: { value: "greenchip.energy" } });
    expect(screen.queryByText("The Inference")).toBeNull();
    expect(screen.getByText("GreenChip")).toBeTruthy();

    // Clear search, filter by status instead.
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("The Inference")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Filter by status/i), {
      target: { value: "active" },
    });
    expect(screen.getByText("The Inference")).toBeTruthy();
    expect(screen.queryByText("GreenChip")).toBeNull();
  });
});
