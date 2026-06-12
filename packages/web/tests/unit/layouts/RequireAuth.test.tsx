import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeResponse } from "@newsletter/shared/types";
import { RequireAuth } from "../../../src/layouts/RequireAuth";
import { fetchMe, UnauthenticatedError } from "../../../src/api/auth";

vi.mock("../../../src/api/auth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/auth")>(
    "../../../src/api/auth",
  );
  return { ...actual, fetchMe: vi.fn() };
});

const fetchMeMock = vi.mocked(fetchMe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGuarded(initialEntry: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/admin" element={<div>Admin home</div>} />
            <Route path="/admin/settings" element={<div>Settings page</div>} />
          </Route>
          <Route path="/login" element={<LocationProbe />} />
          <Route path="/onboarding" element={<div>Wizard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div>login:{location.search}</div>;
}

describe("RequireAuth", () => {
  it("redirects unauthenticated visitors to /login with a next param", async () => {
    fetchMeMock.mockRejectedValue(new UnauthenticatedError());
    renderGuarded("/admin/settings?tab=social");

    await waitFor(() => {
      expect(
        screen.getByText(
          `login:?next=${encodeURIComponent("/admin/settings?tab=social")}`,
        ),
      ).toBeTruthy();
    });
  });

  it("renders the protected outlet when a session exists", async () => {
    const me: MeResponse = {
      user: { id: "u1", name: "Ada", email: "ada@studio.com", role: "tenant_admin" },
      tenant: { id: "t1", name: "My Newsletter", slug: "ada-daily", status: "active" },
      impersonating: false,
    };
    fetchMeMock.mockResolvedValue(me);
    renderGuarded("/admin");

    await waitFor(() => {
      expect(screen.getByText("Admin home")).toBeTruthy();
    });
  });

  it("forces a pending_setup tenant_admin into the onboarding wizard", async () => {
    const me: MeResponse = {
      user: { id: "u1", name: "Ada", email: "ada@studio.com", role: "tenant_admin" },
      tenant: { id: "t1", name: "My Newsletter", slug: "pending-abc", status: "pending_setup" },
      impersonating: false,
    };
    fetchMeMock.mockResolvedValue(me);
    renderGuarded("/admin");

    await waitFor(() => {
      expect(screen.getByText("Wizard")).toBeTruthy();
    });
  });

  it("does not force super admins into the wizard", async () => {
    const me: MeResponse = {
      user: { id: "u0", name: "Root", email: "root@platform.com", role: "super_admin" },
      tenant: null,
      impersonating: false,
    };
    fetchMeMock.mockResolvedValue(me);
    renderGuarded("/admin");

    await waitFor(() => {
      expect(screen.getByText("Admin home")).toBeTruthy();
    });
  });
});
