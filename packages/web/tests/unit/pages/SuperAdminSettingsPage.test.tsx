/**
 * SuperAdminSettingsPage unit tests (REQ-019 relocation, Phase 6).
 *
 * - test_REQ_019_super_admin_settings_page_renders_apify_panel:
 *     SuperAdminSettingsPage renders the ApifyCredentialPanel.
 * - test_REQ_019_super_admin_settings_page_title:
 *     page heading reads "Platform settings".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../src/api/appCredentials", () => ({
  getAppCredentialsStatus: vi.fn(() => new Promise(() => undefined)),
  putApifyToken: vi.fn(),
  deleteApifyToken: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { SuperAdminSettingsPage } from "../../../src/pages/SuperAdminSettingsPage";

function renderPage(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/platform"]}>
        <SuperAdminSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SuperAdminSettingsPage", () => {
  it("test_REQ_019_super_admin_settings_page_renders_apify_panel: renders the Apify credential panel", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("apify-credential-panel")).toBeTruthy();
    });
  });

  it("test_REQ_019_super_admin_settings_page_title: page heading is 'Platform settings'", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /Platform settings/i })).toBeTruthy();
  });
});
