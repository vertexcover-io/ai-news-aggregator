import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { TenantSettings } from "../../../../../src/api/tenant-settings";
import { FeatureFlagsPanel } from "../../../../../src/components/settings/tenant/FeatureFlagsPanel";

vi.mock("../../../../../src/api/tenant-settings", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/api/tenant-settings")
  >("../../../../../src/api/tenant-settings");
  return { ...actual, patchTenantSettings: vi.fn() };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { patchTenantSettings } from "../../../../../src/api/tenant-settings";

const settings: TenantSettings = {
  id: "t1",
  slug: "theinference",
  status: "active",
  name: "The Inference",
  headline: null,
  topicStrip: null,
  subtagline: null,
  canonEnabled: true,
  deliverabilityEnabled: false,
  evalEnabled: false,
  notificationEmail: null,
  slackWebhookConfigured: false,
};

function wrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FeatureFlagsPanel", () => {
  it("renders the three feature toggles reflecting current state", () => {
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <FeatureFlagsPanel settings={settings} />
      </Wrapper>,
    );
    expect(screen.getByText("Deliverability analytics")).toBeTruthy();
    expect(screen.getByText("Canon · Must Read")).toBeTruthy();
    expect(screen.getByText("Eval")).toBeTruthy();
    expect(
      (screen.getByLabelText("Enable Canon Must Read"))
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("patches a flag on toggle", async () => {
    vi.mocked(patchTenantSettings).mockResolvedValue({
      ...settings,
      evalEnabled: true,
    });
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <FeatureFlagsPanel settings={settings} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByLabelText("Enable Eval"));
    await waitFor(() => {
      expect(patchTenantSettings).toHaveBeenCalledWith({ evalEnabled: true });
    });
  });

  it("does not render a shortlist size control (F74)", () => {
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <FeatureFlagsPanel settings={settings} />
      </Wrapper>,
    );
    expect(screen.queryByText(/shortlist size/i)).toBeNull();
  });
});
