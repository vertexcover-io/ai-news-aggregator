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
import type { SendingDomain } from "../../../../../src/api/sending-domains";
import { SendingDomainPanel } from "../../../../../src/components/settings/tenant/SendingDomainPanel";

vi.mock("../../../../../src/api/sending-domains", () => ({
  getDomain: vi.fn(),
  registerDomain: vi.fn(),
  verifyDomain: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import {
  getDomain,
  registerDomain,
  verifyDomain,
} from "../../../../../src/api/sending-domains";

const pendingDomain: SendingDomain = {
  domain: "theinference.com",
  status: "pending",
  verified: false,
  dnsRecords: [
    { type: "TXT", name: "_resend", value: "resend-verify=ab12", status: "verified" },
    { type: "TXT", name: "resend._domainkey", value: "p=MIGf", status: "waiting" },
  ],
  failureReasons: null,
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

describe("SendingDomainPanel", () => {
  it("shows pending status, DNS records, and a verify button", async () => {
    vi.mocked(getDomain).mockResolvedValue(pendingDomain);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SendingDomainPanel />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Pending")).toBeTruthy();
    });
    expect(screen.getByText("_resend")).toBeTruthy();
    expect(screen.getByText("Found")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify domain" })).toBeTruthy();
  });

  it("registers a new domain", async () => {
    vi.mocked(getDomain).mockResolvedValue({
      domain: null,
      status: "none",
      verified: false,
    });
    vi.mocked(registerDomain).mockResolvedValue(pendingDomain);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SendingDomainPanel />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Domain")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Domain"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save domain" }));
    await waitFor(() => {
      expect(registerDomain).toHaveBeenCalledWith("example.com");
    });
  });

  it("triggers verification", async () => {
    vi.mocked(getDomain).mockResolvedValue(pendingDomain);
    vi.mocked(verifyDomain).mockResolvedValue({
      ...pendingDomain,
      status: "verified",
      verified: true,
    });
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SendingDomainPanel />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Verify domain" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify domain" }));
    await waitFor(() => {
      expect(verifyDomain).toHaveBeenCalled();
    });
  });
});
