import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImpersonationBanner } from "../../../src/components/admin/ImpersonationBanner";
import { useSession } from "../../../src/hooks/useSession";
import { exitImpersonation } from "../../../src/api/superAdmin";

vi.mock("../../../src/hooks/useSession", () => ({ useSession: vi.fn() }));
vi.mock("../../../src/api/superAdmin", () => ({
  exitImpersonation: vi.fn(),
}));

const useSessionMock = vi.mocked(useSession);
const exitMock = vi.mocked(exitImpersonation);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function sessionResult(overrides: {
  impersonating: boolean;
  tenant?: { id: string; name: string; slug: string; status: "active" } | null;
}): ReturnType<typeof useSession> {
  return {
    impersonating: overrides.impersonating,
    tenant: overrides.tenant ?? null,
    user: { id: "u1", name: "Root", email: "root@x.io", role: "super_admin" },
    role: "super_admin",
  } as unknown as ReturnType<typeof useSession>;
}

function renderBanner(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<ImpersonationBanner />} />
          <Route path="/admin/tenants" element={<div>tenant list page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ImpersonationBanner (REQ-102)", () => {
  it("renders nothing for a normal session", () => {
    useSessionMock.mockReturnValue(sessionResult({ impersonating: false }));
    renderBanner();
    expect(screen.queryByTestId("impersonation-banner")).toBeNull();
  });

  it("shows the impersonated tenant's name and slug", () => {
    useSessionMock.mockReturnValue(
      sessionResult({
        impersonating: true,
        tenant: { id: "t1", name: "The Inference", slug: "theinference", status: "active" },
      }),
    );
    renderBanner();
    const banner = screen.getByTestId("impersonation-banner");
    expect(banner.textContent).toContain("The Inference");
    expect(banner.textContent).toContain("theinference");
    expect(banner.textContent).toContain("audited");
  });

  it("exit click calls the exit endpoint and navigates to the tenant list", async () => {
    useSessionMock.mockReturnValue(
      sessionResult({
        impersonating: true,
        tenant: { id: "t1", name: "The Inference", slug: "theinference", status: "active" },
      }),
    );
    exitMock.mockResolvedValue(undefined);
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /exit impersonation/i }));

    await waitFor(() => {
      expect(exitMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("tenant list page")).toBeTruthy();
    });
  });
});
