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
import { NotificationsPanel } from "../../../../../src/components/settings/tenant/NotificationsPanel";

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
  canonEnabled: false,
  deliverabilityEnabled: false,
  evalEnabled: false,
  notificationEmail: "ada@studio.com",
  slackWebhookConfigured: true,
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

describe("NotificationsPanel", () => {
  it("pre-fills the notification email and never exposes the webhook secret", () => {
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <NotificationsPanel settings={settings} />
      </Wrapper>,
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Notification email").value,
    ).toBe("ada@studio.com");
    const webhook = screen.getByLabelText<HTMLInputElement>(
      "Slack incoming webhook",
    );
    expect(webhook.value).toBe("");
    expect(webhook.placeholder).toContain("configured");
  });

  it("does not send slackWebhook when the field is untouched", async () => {
    vi.mocked(patchTenantSettings).mockResolvedValue(settings);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <NotificationsPanel settings={settings} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText("Notification email"), {
      target: { value: "new@studio.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notifications" }));
    await waitFor(() => {
      expect(patchTenantSettings).toHaveBeenCalled();
    });
    const arg = vi.mocked(patchTenantSettings).mock.calls[0][0];
    expect(arg).toEqual({ notificationEmail: "new@studio.com" });
    expect("slackWebhook" in arg).toBe(false);
  });

  it("sends slackWebhook when edited", async () => {
    vi.mocked(patchTenantSettings).mockResolvedValue(settings);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <NotificationsPanel settings={settings} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText("Slack incoming webhook"), {
      target: { value: "https://hooks.slack.com/services/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notifications" }));
    await waitFor(() => {
      expect(patchTenantSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          slackWebhook: "https://hooks.slack.com/services/new",
        }),
      );
    });
  });
});
