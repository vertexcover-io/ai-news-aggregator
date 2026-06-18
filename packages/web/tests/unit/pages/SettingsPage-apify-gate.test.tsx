/**
 * SettingsPage no longer renders ApifyCredentialPanel for any role (REQ-019
 * relocation, Phase 6). The panel lives at /admin/platform instead.
 *
 * - test_REQ_019_apify_panel_absent_for_super_admin_on_settings: super_admin
 *   visiting the tenant settings page does NOT see the Apify panel.
 * - test_REQ_019_apify_panel_absent_for_tenant_admin_on_settings: tenant_admin
 *   visiting the tenant settings page does NOT see the Apify panel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../src/hooks/useSession", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: vi.fn(() => ({
    data: null,
    isLoading: true,
    dataUpdatedAt: 0,
  })),
}));

vi.mock("../../../src/api/settings", () => ({
  putSettings: vi.fn(),
  SettingsApiError: class extends Error {},
}));
vi.mock("../../../src/api/runs", () => ({
  triggerRunNow: vi.fn(),
}));
vi.mock("../../../src/api/branding", () => ({
  getBrandingSettings: vi.fn(() => new Promise(() => undefined)),
  putBrandingSettings: vi.fn(),
  uploadBrandingLogo: vi.fn(),
}));
vi.mock("../../../src/api/socialCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/socialCredentials")>();
  return {
    ...actual,
    useSocialCredentialsStatus: vi.fn(() => ({ data: undefined, isLoading: true })),
    useSaveTwitterCredentials: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useDeleteSocialCredentials: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useLinkedInOAuthStatus: vi.fn(() => ({ data: undefined, isLoading: true })),
    useTwitterOAuthStatus: vi.fn(() => ({ data: undefined, isLoading: true })),
    fetchLinkedInOAuthStatus: vi.fn(() => new Promise(() => undefined)),
    startLinkedInOAuth: vi.fn(),
    startTwitterOAuth: vi.fn(),
  };
});
vi.mock("../../../src/api/emailSettings", () => ({
  getEmailSettings: vi.fn(() => new Promise(() => undefined)),
  putEmailSettings: vi.fn(),
  EmailSettingsApiError: class extends Error {},
}));
vi.mock("../../../src/api/sendingDomain", () => ({
  getSendingDomain: vi.fn(() => new Promise(() => undefined)),
  getSendingDomainStatus: vi.fn(() => new Promise(() => undefined)),
  addSendingDomain: vi.fn(),
  verifySendingDomain: vi.fn(),
  deleteSendingDomain: vi.fn(),
  SendingDomainApiError: class extends Error {},
}));
vi.mock("../../../src/api/notificationSettings", () => ({
  getNotificationSettings: vi.fn(() => new Promise(() => undefined)),
  putNotificationSettings: vi.fn(),
}));
vi.mock("../../../src/api/appCredentials", () => ({
  getAppCredentialsStatus: vi.fn(() => new Promise(() => undefined)),
  putApifyToken: vi.fn(),
  deleteApifyToken: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { useSession } from "../../../src/hooks/useSession";
import { SettingsPage } from "../../../src/pages/SettingsPage";
import type { AuthMeResponse } from "@newsletter/shared/types/tenant";

const mockUseSession = useSession as unknown as ReturnType<typeof vi.fn>;

function renderSettings(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SettingsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsPage ApifyCredentialPanel absent (REQ-019 relocation)", () => {
  it("test_REQ_019_apify_panel_absent_for_super_admin_on_settings: super_admin does NOT see the Apify section on tenant settings", async () => {
    const sessionData: AuthMeResponse = {
      user: {
        id: "user-super-1",
        email: "super@example.com",
        name: "Super Admin",
        role: "super_admin",
        tenantId: null,
      },
      tenant: null,
    };
    mockUseSession.mockReturnValue({ data: sessionData, isLoading: false });

    renderSettings();

    await waitFor(() => screen.getByRole("heading", { name: /Settings/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("apify-credential-panel")).toBeNull();
    });
  });

  it("test_REQ_019_apify_panel_absent_for_tenant_admin_on_settings: tenant_admin does NOT see the Apify section on tenant settings", async () => {
    const sessionData: AuthMeResponse = {
      user: {
        id: "user-tenant-1",
        email: "admin@tenant.com",
        name: "Tenant Admin",
        role: "tenant_admin",
        tenantId: "tenant-uuid-1",
      },
      tenant: {
        id: "tenant-uuid-1",
        slug: "my-tenant",
        name: "My Tenant",
        status: "active",
      },
    };
    mockUseSession.mockReturnValue({ data: sessionData, isLoading: false });

    renderSettings();

    await waitFor(() => screen.getByRole("heading", { name: /Settings/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("apify-credential-panel")).toBeNull();
    });
  });
});
