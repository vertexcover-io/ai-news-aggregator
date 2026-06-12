import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "../../../src/pages/admin/SettingsPage";
import {
  getTenantSettings,
  putTenantSettings,
  type TenantSettings,
} from "../../../src/pages/admin/SettingsPageApi";

vi.mock("../../../src/pages/admin/SettingsPageApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/pages/admin/SettingsPageApi")
  >("../../../src/pages/admin/SettingsPageApi");
  return {
    ...actual,
    getTenantSettings: vi.fn(),
    putTenantSettings: vi.fn(),
    putBranding: vi.fn(),
    uploadLogo: vi.fn(),
    getSendingDomain: vi.fn().mockResolvedValue(null),
    registerSendingDomain: vi.fn(),
    verifySendingDomain: vi.fn(),
    fetchTwitterOAuthStatus: vi.fn().mockResolvedValue({
      clientConfigured: true,
      connected: false,
      connectedAs: null,
      expiresAt: null,
      hasRefreshToken: false,
    }),
    startTwitterOAuth: vi.fn(),
    disconnectTwitter: vi.fn(),
  };
});

vi.mock("../../../src/api/socialCredentials", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/api/socialCredentials")
  >("../../../src/api/socialCredentials");
  return {
    ...actual,
    fetchLinkedInOAuthStatus: vi.fn().mockResolvedValue({
      clientConfigured: true,
      connected: true,
      connectedAs: "The Inference",
      expiresAt: null,
      hasRefreshToken: true,
    }),
    startLinkedInOAuth: vi.fn(),
  };
});

vi.mock("../../../src/hooks/useSession", () => ({
  useSession: vi.fn(() => ({
    impersonating: false,
    tenant: { id: "t1", name: "The Inference", slug: "theinference", status: "active" },
    user: { id: "u1", name: "Ada", email: "ada@x.io", role: "tenant_admin" },
    role: "tenant_admin",
  })),
}));

vi.mock("../../../src/api/runs", () => ({
  triggerRunNow: vi.fn(),
}));

const getSettingsMock = vi.mocked(getTenantSettings);
const putSettingsMock = vi.mocked(putTenantSettings);

const SETTINGS: TenantSettings = {
  id: "settings-1",
  topN: 12,
  halfLifeHours: 24,
  hnEnabled: true,
  hnConfig: { sinceDays: 1 },
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  webSearchEnabled: false,
  webSearchConfig: null,
  posthogEnabled: false,
  posthogProjectToken: null,
  posthogHost: null,
  scheduleTime: "07:00",
  pipelineTime: "07:00",
  emailTime: "07:30",
  linkedinTime: "07:45",
  twitterTime: "08:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
  rankingPrompt: "Rank prompt",
  shortlistPrompt: "Shortlist prompt",
  updatedAt: "2026-06-01T00:00:00.000Z",
  canonEnabled: false,
  deliverabilityEnabled: false,
  evalEnabled: false,
  notificationEmail: "ops@inference.io",
  hasSlackWebhook: true,
};

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
      <MemoryRouter initialEntries={["/admin/settings"]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage assembly (Phase 12)", () => {
  it("renders all panels from the settings mock", async () => {
    getSettingsMock.mockResolvedValue(SETTINGS);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Branding" })).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: "Social posting" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sending domain" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Features" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Prompts" })).toBeTruthy();
  });

  it("REQ-094: never renders a shortlist size field", async () => {
    getSettingsMock.mockResolvedValue(SETTINGS);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Features" })).toBeTruthy();
    });
    expect(screen.queryByText(/shortlist size/i)).toBeNull();
    expect(document.getElementById("shortlistSize")).toBeNull();
  });

  it("hydrates notification email and masked Slack webhook state", async () => {
    getSettingsMock.mockResolvedValue(SETTINGS);
    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("ops@inference.io")).toBeTruthy();
    });
    expect(
      screen.getByText(/a webhook is configured — stored encrypted/i),
    ).toBeTruthy();
  });

  it("REQ-093: feature toggles render off by default and submit with the form", async () => {
    getSettingsMock.mockResolvedValue(SETTINGS);
    putSettingsMock.mockResolvedValue({ ...SETTINGS, canonEnabled: true });
    renderPage();

    // Wait for hydration (the effect resets panel state from the fetch).
    await waitFor(() => {
      expect(screen.getByDisplayValue("ops@inference.io")).toBeTruthy();
    });

    const canonToggle = screen.getByRole("switch", { name: /canon/i });
    expect((canonToggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(canonToggle);

    const form = document.getElementById("settings-form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(putSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = putSettingsMock.mock.calls[0][0];
    expect(payload.canonEnabled).toBe(true);
    expect(payload.deliverabilityEnabled).toBe(false);
    expect(payload.evalEnabled).toBe(false);
    expect("shortlistSize" in payload).toBe(false);
    // Empty webhook input must not clear the stored webhook.
    expect("slackWebhookUrl" in payload).toBe(false);
    expect(payload.notificationEmail).toBe("ops@inference.io");
  });

  it("shows LinkedIn connection status from the OAuth status endpoint", async () => {
    getSettingsMock.mockResolvedValue(SETTINGS);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/connected as the inference/i)).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: /connect with x/i }),
    ).toBeTruthy();
  });
});
