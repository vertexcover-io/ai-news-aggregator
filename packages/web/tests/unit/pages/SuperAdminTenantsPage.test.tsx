import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

vi.mock("../../../src/api/super", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/super")>(
    "../../../src/api/super",
  );
  return {
    ...actual,
    listTenants: vi.fn(),
    impersonateTenant: vi.fn(),
  };
});

vi.mock("../../../src/hooks/useAdminSession", () => ({
  useAdminSession: vi.fn(),
}));

import { listTenants, impersonateTenant } from "../../../src/api/super";
import { useAdminSession } from "../../../src/hooks/useAdminSession";
import { SuperAdminTenantsPage } from "../../../src/pages/SuperAdminTenantsPage";

const tenantOne = {
  id: "t-1",
  slug: "agentloop",
  name: "AGENTLOOP",
  status: "active",
  customDomain: "agentloop.dev",
  headline: null,
  topicStrip: null,
  subtagline: null,
  logoBytes: null,
  logoContentType: null,
  featureCanon: false,
  featureDeliverability: false,
  featureEval: false,
  domainId: null,
  domainName: null,
  domainStatus: null,
  domainRecords: null,
  onboardingState: null,
  oldSlug: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const tenantTwo = {
  id: "t-2",
  slug: "the-inference",
  name: "The Inference",
  status: "pending_setup",
  customDomain: null,
  headline: null,
  topicStrip: null,
  subtagline: null,
  logoBytes: null,
  logoContentType: null,
  featureCanon: false,
  featureDeliverability: false,
  featureEval: false,
  domainId: null,
  domainName: null,
  domainStatus: null,
  domainRecords: null,
  onboardingState: null,
  oldSlug: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(useAdminSession).mockReturnValue({
    data: { admin: true as const },
    isLoading: false,
    isError: false,
    dataUpdatedAt: 0,
    error: null,
  } as unknown as ReturnType<typeof useAdminSession>);
  vi.mocked(listTenants).mockReset();
  vi.mocked(impersonateTenant).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SuperAdminTenantsPage", () => {
  it("REQ-100: renders tenant list with names and statuses", async () => {
    vi.mocked(listTenants).mockResolvedValue([tenantOne, tenantTwo]);

    render(
      <Wrapper>
        <SuperAdminTenantsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeDefined();
    });
    expect(screen.getByText("The Inference")).toBeDefined();
    // Both tenant status badges and filter dropdown contain these labels
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("In setup").length).toBeGreaterThanOrEqual(2);
  });

  it("REQ-100: shows super admin header with platform overview", async () => {
    vi.mocked(listTenants).mockResolvedValue([tenantOne]);

    render(
      <Wrapper>
        <SuperAdminTenantsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeDefined();
    });
    // Header should indicate super-admin context
    expect(screen.getByText("Tenants")).toBeDefined();
  });

  it("REQ-100: shows stat cards with totals", async () => {
    vi.mocked(listTenants).mockResolvedValue([tenantOne, tenantTwo]);

    render(
      <Wrapper>
        <SuperAdminTenantsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeDefined();
    });

    // Total tenants stat
    expect(screen.getByText("2")).toBeDefined();
    // Active and Pending stat cards each show "1"
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(2);
    // Stat card labels present (also appear in filter dropdown, so getAllByText ≥ 2)
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("In setup").length).toBeGreaterThanOrEqual(2);
  });

  it("REQ-100: search input filters tenants by name", async () => {
    vi.mocked(listTenants).mockResolvedValue([tenantOne, tenantTwo]);

    render(
      <Wrapper>
        <SuperAdminTenantsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText(/search tenants/i);
    fireEvent.change(searchInput, { target: { value: "inference" } });

    await waitFor(() => {
      expect(screen.queryByText("AGENTLOOP")).toBeNull();
    });
    expect(screen.getByText("The Inference")).toBeDefined();
  });

  it("REQ-100: status filter filters by tenant status", async () => {
    vi.mocked(listTenants).mockResolvedValue([tenantOne, tenantTwo]);

    render(
      <Wrapper>
        <SuperAdminTenantsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeDefined();
    });

    const statusSelect = screen.getByRole("combobox", { name: /status/i });
    fireEvent.change(statusSelect, { target: { value: "active" } });

    await waitFor(() => {
      expect(screen.queryByText("The Inference")).toBeNull();
    });
    expect(screen.getByText("AGENTLOOP")).toBeDefined();
  });

  it("REQ-101: open button calls impersonate then attempts navigation", async () => {
    vi.mocked(listTenants).mockResolvedValue([tenantOne]);
    vi.mocked(impersonateTenant).mockResolvedValue({
      ok: true,
      tenantId: "t-1",
      tenantName: "AGENTLOOP",
    });

    // Spy on window.location.assign — jsdom makes location non-configurable,
    // so stub assign directly on the existing location object.
    const assignSpy = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      assign: assignSpy,
      href: window.location.href,
    });

    render(
      <Wrapper>
        <SuperAdminTenantsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("AGENTLOOP")).toBeDefined();
    });

    const openButtons = screen.getAllByRole("button", { name: /open/i });
    fireEvent.click(openButtons[0]);

    await waitFor(() => {
      expect(impersonateTenant).toHaveBeenCalledWith("t-1");
    });

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith("/admin");
    });

    vi.unstubAllGlobals();
  });
});
