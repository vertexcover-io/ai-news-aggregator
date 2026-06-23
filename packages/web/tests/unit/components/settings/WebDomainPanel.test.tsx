/**
 * WebDomainPanel (Fix #3, Phase C): add a domain → see the DNS record →
 * verify. No real network — the api client is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../../../src/api/webDomain", () => ({
  getWebDomain: vi.fn(),
  registerWebDomain: vi.fn(),
  verifyWebDomain: vi.fn(),
  WebDomainApiError: class extends Error {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { getWebDomain, registerWebDomain } from "../../../../src/api/webDomain";
import { WebDomainPanel } from "../../../../src/components/settings/WebDomainPanel";

const mockGet = getWebDomain as unknown as MockInstance;
const mockRegister = registerWebDomain as unknown as MockInstance;

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WebDomainPanel />
    </QueryClientProvider> as ReactNode,
  );
}

beforeEach(() => {
  mockGet.mockResolvedValue({ domain: null, status: null, record: null, verifiedAt: null });
  mockRegister.mockResolvedValue({
    domain: "news.acme.com",
    status: "pending",
    record: { type: "CNAME", name: "news.acme.com", value: "ingress.vertexcover.io" },
    verifiedAt: null,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WebDomainPanel", () => {
  it("adds a domain and shows the DNS record to create", async () => {
    renderPanel();
    await waitFor(() => screen.getByTestId("web-domain-add-btn"));
    fireEvent.change(screen.getByTestId("web-domain-input"), {
      target: { value: "news.acme.com" },
    });
    fireEvent.click(screen.getByTestId("web-domain-add-btn"));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalled();
    });
    expect(mockRegister.mock.calls[0]?.[0]).toBe("news.acme.com");
    await waitFor(() => {
      expect(screen.getByTestId("web-domain-record-type").textContent).toBe("CNAME");
    });
    expect(screen.getByTestId("web-domain-record-value").textContent).toBe(
      "ingress.vertexcover.io",
    );
    expect(screen.getByTestId("web-domain-status").textContent).toContain("Pending");
  });

  it("shows the verified state when the domain is already verified", async () => {
    mockGet.mockResolvedValue({
      domain: "news.acme.com",
      status: "verified",
      record: { type: "CNAME", name: "news.acme.com", value: "ingress.vertexcover.io" },
      verifiedAt: "2026-06-18T00:00:00.000Z",
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId("web-domain-status").textContent).toContain("Verified");
    });
  });
});
