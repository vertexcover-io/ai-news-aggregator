import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { TenantSettings } from "../../../../src/api/tenant-settings";
import { TenantSettingsPage } from "../../../../src/pages/TenantSettingsPage";

vi.mock("../../../../src/api/tenant-settings", () => ({
  getTenantSettings: vi.fn(),
  patchTenantSettings: vi.fn(),
}));
vi.mock("../../../../src/api/tenant-sources", () => ({
  listSources: vi.fn().mockResolvedValue([]),
  addSource: vi.fn(),
  setSourceEnabled: vi.fn(),
  removeSource: vi.fn(),
  discover: vi.fn(),
}));
vi.mock("../../../../src/api/sending-domains", () => ({
  getDomain: vi.fn().mockResolvedValue({
    domain: null,
    status: "none",
    verified: false,
  }),
  registerDomain: vi.fn(),
  verifyDomain: vi.fn(),
}));
vi.mock("../../../../src/api/onboarding", () => ({ uploadLogo: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { getTenantSettings } from "../../../../src/api/tenant-settings";

const settings: TenantSettings = {
  id: "t1",
  slug: "theinference",
  status: "active",
  name: "The Inference",
  headline: null,
  topicStrip: null,
  subtagline: null,
  canonEnabled: false,
  deliverabilityEnabled: false,
  evalEnabled: false,
  notificationEmail: null,
  slackWebhookConfigured: false,
};

function renderPage(): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TenantSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TenantSettingsPage", () => {
  it("composes all five panels once settings load, and omits shortlist size", async () => {
    vi.mocked(getTenantSettings).mockResolvedValue(settings);
    render(renderPage());
    await waitFor(() => {
      expect(screen.getByText("Branding")).toBeTruthy();
    });
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("Sending domain")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Features")).toBeTruthy();
    expect(screen.queryByText(/shortlist size/i)).toBeNull();
  });
});
