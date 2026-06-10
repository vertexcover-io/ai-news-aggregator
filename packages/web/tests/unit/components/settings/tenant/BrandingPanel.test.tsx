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
import { BrandingPanel } from "../../../../../src/components/settings/tenant/BrandingPanel";
import type { TenantSettings } from "../../../../../src/api/tenant-settings";

vi.mock("../../../../../src/api/tenant-settings", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../src/api/tenant-settings")
  >("../../../../../src/api/tenant-settings");
  return { ...actual, patchTenantSettings: vi.fn() };
});
vi.mock("../../../../../src/api/onboarding", () => ({
  uploadLogo: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { patchTenantSettings } from "../../../../../src/api/tenant-settings";

const settings: TenantSettings = {
  id: "t1",
  slug: "theinference",
  status: "active",
  name: "The Inference",
  headline: "The daily read for *inference*",
  topicStrip: "LLMs · agents",
  subtagline: "Your daily AI briefing",
  canonEnabled: false,
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

describe("BrandingPanel", () => {
  it("renders branding fields pre-filled and shows the slug subdomain", () => {
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <BrandingPanel settings={settings} />
      </Wrapper>,
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Newsletter name").value,
    ).toBe("The Inference");
    expect(screen.getByText("theinference")).toBeTruthy();
    expect(screen.getByLabelText("Upload logo")).toBeTruthy();
  });

  it("submits trimmed branding values", async () => {
    vi.mocked(patchTenantSettings).mockResolvedValue({
      ...settings,
      name: "Renamed",
    });
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <BrandingPanel settings={settings} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText("Newsletter name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(patchTenantSettings).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Renamed" }),
      );
    });
  });
});
