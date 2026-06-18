/**
 * EmailPanel (Fix #3, Phase B): mode switch + SMTP form save payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../../../src/api/emailSettings", () => ({
  getEmailSettings: vi.fn(),
  putEmailSettings: vi.fn(),
  EmailSettingsApiError: class extends Error {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { getEmailSettings, putEmailSettings } from "../../../../src/api/emailSettings";
import { EmailPanel } from "../../../../src/components/settings/EmailPanel";

const mockGet = getEmailSettings as unknown as MockInstance;
const mockPut = putEmailSettings as unknown as MockInstance;

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmailPanel />
    </QueryClientProvider> as ReactNode,
  );
}

beforeEach(() => {
  mockGet.mockResolvedValue({
    mode: "managed",
    effectiveSender: "inference@news.vertexcover.io",
    smtp: null,
  });
  mockPut.mockResolvedValue({
    mode: "smtp",
    effectiveSender: "news@acme.com",
    smtp: { host: "smtp.acme.com", port: 587, secure: false, username: "u", fromAddress: "news@acme.com", passwordSet: true },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmailPanel", () => {
  it("shows the effective sender from the loaded settings", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId("email-effective-sender").textContent).toBe(
        "inference@news.vertexcover.io",
      );
    });
  });

  it("saving managed mode PUTs just the mode", async () => {
    renderPanel();
    await waitFor(() => screen.getByTestId("email-save-btn"));
    fireEvent.click(screen.getByTestId("email-save-btn"));
    await waitFor(() => {
      expect(mockPut).toHaveBeenCalled();
    });
    expect(mockPut.mock.calls[0]?.[0]).toEqual({ mode: "managed" });
  });

  it("switching to SMTP reveals the form and saves the entered config", async () => {
    renderPanel();
    await waitFor(() => screen.getByTestId("email-mode-smtp"));
    fireEvent.click(screen.getByTestId("email-mode-smtp"));
    expect(screen.getByTestId("email-smtp-form")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "smtp.acme.com" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "p" } });
    fireEvent.change(screen.getByLabelText("From address"), { target: { value: "news@acme.com" } });
    fireEvent.click(screen.getByTestId("email-save-btn"));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalled();
    });
    const arg = mockPut.mock.calls[0]?.[0] as {
      mode: string;
      smtp?: Record<string, unknown>;
    };
    expect(arg.mode).toBe("smtp");
    expect(arg.smtp).toEqual(
      expect.objectContaining({
        host: "smtp.acme.com",
        port: 587,
        username: "u",
        password: "p",
        fromAddress: "news@acme.com",
      }),
    );
  });
});
