import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("../../src/api/super-admin", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/super-admin")>(
      "../../src/api/super-admin",
    );
  return { ...actual, listTenants: vi.fn(), impersonate: vi.fn() };
});

import { SuperAdminPage } from "../../src/pages/SuperAdminPage";
import {
  listTenants,
  impersonate,
  type SuperAdminTenant,
} from "../../src/api/super-admin";
import { clearImpersonation } from "../../src/hooks/useImpersonation";

const listTenantsMock = vi.mocked(listTenants);
const impersonateMock = vi.mocked(impersonate);

function makeTenant(
  id: string,
  overrides: Partial<SuperAdminTenant> = {},
): SuperAdminTenant {
  return {
    id,
    slug: `slug-${id}`,
    name: `Tenant ${id}`,
    status: "active",
    customDomain: `${id}.example.com`,
    userCount: 1,
    subscriberCount: 100,
    lastRunAt: "2026-06-10T10:00:00.000Z",
    ...overrides,
  };
}

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/super-admin"]}>
          <SuperAdminPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

beforeEach(() => {
  listTenantsMock.mockReset();
  impersonateMock.mockReset();
  clearImpersonation();
  vi.stubGlobal("location", { assign: vi.fn() } as unknown as Location);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SuperAdminPage", () => {
  it("renders a row per tenant with status and subscriber count", async () => {
    listTenantsMock.mockResolvedValue([
      makeTenant("aaa", { subscriberCount: 8210 }),
      makeTenant("bbb", { status: "in_setup", subscriberCount: 0, lastRunAt: null, customDomain: null }),
    ]);
    renderPage();
    await screen.findByTestId("super-admin-row-aaa");
    expect(screen.getByTestId("super-admin-row-bbb")).toBeTruthy();
    const rowA = screen.getByTestId("super-admin-row-aaa");
    expect(rowA.textContent).toContain("8,210");
    expect(rowA.textContent).toContain("Active");
    const rowB = screen.getByTestId("super-admin-row-bbb");
    expect(rowB.textContent).toContain("In setup");
    expect(rowB.textContent).toContain("— not set —");
  });

  it("computes the stat cards from the tenant list", async () => {
    listTenantsMock.mockResolvedValue([
      makeTenant("a", { subscriberCount: 1000 }),
      makeTenant("b", { subscriberCount: 200 }),
      makeTenant("c", { status: "in_setup", subscriberCount: 0 }),
    ]);
    renderPage();
    await screen.findByTestId("super-admin-row-a");
    const stats = screen.getByTestId("super-admin-stats");
    expect(stats.textContent).toContain("3"); // total
    expect(stats.textContent).toContain("1.2k"); // subscribers compacted
  });

  it("filters rows by the search box", async () => {
    listTenantsMock.mockResolvedValue([
      makeTenant("aaa", { name: "AgentLoop" }),
      makeTenant("bbb", { name: "The Inference" }),
    ]);
    renderPage();
    await screen.findByTestId("super-admin-row-aaa");
    fireEvent.change(screen.getByTestId("super-admin-search"), {
      target: { value: "inference" },
    });
    await waitFor(() => {
      expect(screen.queryByTestId("super-admin-row-aaa")).toBeNull();
    });
    expect(screen.getByTestId("super-admin-row-bbb")).toBeTruthy();
  });

  it("clicking Open calls impersonate and records the impersonation target", async () => {
    impersonateMock.mockResolvedValue({ tenantId: "aaa" });
    listTenantsMock.mockResolvedValue([makeTenant("aaa", { name: "AgentLoop" })]);
    renderPage();
    await screen.findByTestId("super-admin-open-aaa");
    fireEvent.click(screen.getByTestId("super-admin-open-aaa"));
    await waitFor(() => {
      expect(impersonateMock).toHaveBeenCalledWith("aaa");
    });
    await waitFor(() => {
      const raw = window.sessionStorage.getItem("newsletter.impersonation");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw ?? "{}")).toMatchObject({
        tenantId: "aaa",
        tenantName: "AgentLoop",
      });
    });
  });

  it("renders an error block when listTenants rejects", async () => {
    listTenantsMock.mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByTestId("super-admin-error");
    expect(screen.getByText("boom")).toBeTruthy();
  });
});
