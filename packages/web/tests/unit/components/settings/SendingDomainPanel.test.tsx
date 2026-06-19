/**
 * P14: Sending-domain panel in Settings (REQ-084/085 UI).
 *
 * - No domain registered → input + "Add domain"; add → DNS records table.
 * - Registered pending → Pending badge, DNS records, paused-broadcast copy,
 *   "Verify domain" button.
 * - Verify → mutation; verified → Verified badge; failed → reasons listed.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SendingDomainWire } from "@newsletter/shared/types/tenant";

vi.mock("../../../../src/api/sendingDomain", () => ({
  getSendingDomain: vi.fn(),
  addSendingDomain: vi.fn(),
  verifySendingDomain: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import {
  addSendingDomain,
  getSendingDomain,
  verifySendingDomain,
} from "../../../../src/api/sendingDomain";
import { SendingDomainPanel } from "../../../../src/components/settings/SendingDomainPanel";

const mockGet = getSendingDomain as unknown as MockInstance;
const mockAdd = addSendingDomain as unknown as MockInstance;
const mockVerify = verifySendingDomain as unknown as MockInstance;

const pendingDomain: SendingDomainWire = {
  domain: "theinference.com",
  status: "pending",
  records: [
    {
      record: "DKIM",
      type: "TXT",
      name: "resend._domainkey",
      value: "p=MIGfMA0GCSq",
      status: "not_started",
    },
    {
      record: "SPF",
      type: "MX",
      name: "send",
      value: "feedback-smtp.resend.com",
      priority: 10,
      status: "not_started",
    },
  ],
};

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<SendingDomainPanel />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SendingDomainPanel", () => {
  it("with no registered domain: shows the add form, and adding renders the returned DNS records", async () => {
    mockGet.mockResolvedValue(null);
    mockAdd.mockResolvedValue(pendingDomain);
    renderPanel();

    const input = await screen.findByPlaceholderText(/yourdomain\.com/i);
    fireEvent.change(input, { target: { value: "theinference.com" } });
    fireEvent.click(screen.getByRole("button", { name: /add domain/i }));

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledWith("theinference.com", expect.anything());
    });
    // DNS records table appears with the record values.
    expect(await screen.findByText("resend._domainkey")).toBeTruthy();
    expect(screen.getByText("feedback-smtp.resend.com")).toBeTruthy();
    expect(screen.getByTestId("sending-domain-status").textContent).toMatch(/pending/i);
  });

  it("registered pending domain: renders badge, records, paused copy and Verify button", async () => {
    mockGet.mockResolvedValue(pendingDomain);
    renderPanel();

    expect(await screen.findByText("theinference.com")).toBeTruthy();
    expect(screen.getByTestId("sending-domain-status").textContent).toMatch(/pending/i);
    expect(screen.getByText(/broadcast is paused/i)).toBeTruthy();
    expect(screen.getByText("resend._domainkey")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /verify domain/i }),
    ).toBeTruthy();
  });

  it("verify → verified: badge updates", async () => {
    mockGet.mockResolvedValue(pendingDomain);
    mockVerify.mockResolvedValue({
      ...pendingDomain,
      status: "verified",
      records: pendingDomain.records.map((r) => ({ ...r, status: "verified" })),
    });
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: /verify domain/i }),
    );

    await waitFor(() => {
      expect(mockVerify).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.getByTestId("sending-domain-status").textContent).toMatch(/verified/i);
    });
  });

  it("verify → failed: reasons are listed", async () => {
    mockGet.mockResolvedValue(pendingDomain);
    mockVerify.mockResolvedValue({
      ...pendingDomain,
      status: "failed",
      reasons: ['DKIM TXT record "resend._domainkey" is failed'],
    });
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: /verify domain/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("sending-domain-status").textContent).toMatch(/failed/i);
    });
    expect(
      screen.getByText(/DKIM TXT record "resend\._domainkey" is failed/),
    ).toBeTruthy();
  });
});
