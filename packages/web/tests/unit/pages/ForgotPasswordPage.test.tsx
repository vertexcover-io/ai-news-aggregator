import { describe, expect, it, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../../src/api/auth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/api/auth")>(
      "../../../src/api/auth",
    );
  return { ...actual, forgotPassword: vi.fn() };
});

import { forgotPassword } from "../../../src/api/auth";
import { ForgotPasswordPage } from "../../../src/pages/ForgotPasswordPage";

const mockForgot = vi.mocked(forgotPassword);

// Lazily create a fresh rejected promise per call. Using mockImplementation (vs
// mockRejectedValue, which eagerly builds one rejected promise the suite's
// unhandled-rejection guard flags) lets react-query attach its catch handler
// before the promise settles.
const rejectRequest = (): Promise<void> => Promise.reject(new Error("boom"));

function renderPage(): void {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Reset after each test (not before) so a rejecting implementation is torn down
// once the mutation has fully settled, keeping its rejection from leaking past
// the test that owns it.
afterEach(() => {
  cleanup();
  mockForgot.mockReset();
});

describe("ForgotPasswordPage", () => {
  it("renders the email field and submit button", () => {
    renderPage();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeTruthy();
  });

  it("calls forgotPassword and shows the neutral confirmation on success", async () => {
    mockForgot.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@studio.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(mockForgot).toHaveBeenCalledWith("ada@studio.com");
    });
    expect(await screen.findByText(/reset link is on its way/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /send reset link/i }),
    ).toBeNull();
  });

  it("shows an error message when the request fails", async () => {
    mockForgot.mockImplementation(rejectRequest);
    renderPage();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@studio.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(
      await screen.findByText("Something went wrong. Try again."),
    ).toBeTruthy();
  });
});
