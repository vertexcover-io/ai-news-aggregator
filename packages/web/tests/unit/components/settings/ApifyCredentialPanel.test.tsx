/**
 * ApifyCredentialPanel unit tests (REQ-019, Phase 5).
 *
 * - test_REQ_019_renders_unconfigured_status: panel shows "Not configured" when
 *   getAppCredentialsStatus returns apify.configured = false.
 * - test_REQ_019_renders_configured_status: panel shows configured badge +
 *   updatedAt when apify.configured = true.
 * - test_REQ_019_save_calls_mutation: filling the input and saving calls
 *   putApifyToken with the entered value.
 * - test_REQ_019_clear_calls_delete_mutation: clicking "Clear" calls deleteApifyToken.
 * - test_REQ_019_no_secret_rendered: the panel never renders the token value.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../../../src/api/appCredentials", () => ({
  getAppCredentialsStatus: vi.fn(),
  putApifyToken: vi.fn(),
  deleteApifyToken: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import {
  getAppCredentialsStatus,
  putApifyToken,
  deleteApifyToken,
} from "../../../../src/api/appCredentials";
import { ApifyCredentialPanel } from "../../../../src/components/settings/ApifyCredentialPanel";

const mockGetStatus = getAppCredentialsStatus as unknown as MockInstance;
const mockPut = putApifyToken as unknown as MockInstance;
const mockDelete = deleteApifyToken as unknown as MockInstance;

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<ApifyCredentialPanel />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ApifyCredentialPanel (REQ-019)", () => {
  it("test_REQ_019_renders_unconfigured_status: shows not configured when apify row is absent", async () => {
    mockGetStatus.mockResolvedValue({
      apify: { configured: false, updatedAt: null },
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("apify-credential-panel")).toBeTruthy();
    });
    expect(screen.getByText(/not configured/i)).toBeTruthy();
  });

  it("test_REQ_019_renders_configured_status: shows configured badge + updatedAt when apify row exists", async () => {
    mockGetStatus.mockResolvedValue({
      apify: { configured: true, updatedAt: "2026-06-18T12:00:00.000Z" },
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/configured/i)).toBeTruthy();
    });
    // updatedAt must be displayed (formatted or raw ISO).
    await waitFor(() => {
      const panelText = screen.getByTestId("apify-credential-panel").textContent ?? "";
      expect(panelText).toMatch(/updated/i);
    });
  });

  it("test_REQ_019_save_calls_mutation: submitting the form calls putApifyToken with entered value", async () => {
    mockGetStatus.mockResolvedValue({
      apify: { configured: false, updatedAt: null },
    });
    mockPut.mockResolvedValue({ configured: true, updatedAt: "2026-06-18T12:00:00.000Z" });
    renderPanel();

    await waitFor(() => screen.getByTestId("apify-credential-panel"));

    fireEvent.change(screen.getByLabelText(/Apify API token/i), {
      target: { value: "apify_secret_key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith("apify_secret_key");
    });
  });

  it("test_REQ_019_clear_calls_delete_mutation: clicking Clear calls deleteApifyToken", async () => {
    mockGetStatus.mockResolvedValue({
      apify: { configured: true, updatedAt: "2026-06-18T12:00:00.000Z" },
    });
    mockDelete.mockResolvedValue({ ok: true });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Clear/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  it("test_REQ_019_no_secret_rendered: the panel never renders the token value", async () => {
    // Even if someone accidentally put the token in the API response, panel must not
    // echo it. The query returns only configured/updatedAt — test that the input
    // (type=password) never displays the API-returned value.
    mockGetStatus.mockResolvedValue({
      apify: { configured: true, updatedAt: "2026-06-18T12:00:00.000Z" },
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("apify-credential-panel")).toBeTruthy();
    });

    // The password input must be of type password (masked).
    const input = screen.getByLabelText(/Apify API token/i);
    expect((input as HTMLInputElement).type).toBe("password");
    // The input's value must be empty (never pre-filled with a secret).
    expect((input as HTMLInputElement).value).toBe("");
  });
});
