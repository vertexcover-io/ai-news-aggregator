import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignupPage } from "../../../src/pages/SignupPage";
import { signup, EmailInUseError } from "../../../src/api/auth";

vi.mock("../../../src/api/auth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/auth")>(
    "../../../src/api/auth",
  );
  return { ...actual, signup: vi.fn() };
});

const signupMock = vi.mocked(signup);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSignupPage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/signup"]}>
        <SignupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillField(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("SignupPage", () => {
  it("blocks submit and shows a mismatch error when passwords differ (REQ-002)", async () => {
    renderSignupPage();
    fillField(/your name/i, "Ada Lovelace");
    fillField(/work email/i, "ada@studio.com");
    fillField(/^password$/i, "password123");
    fillField(/^confirm$/i, "password456");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwords don’t match/i)).toBeTruthy();
    });
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("submits matching passwords to the signup API", async () => {
    signupMock.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "ada@studio.com", role: "tenant_admin" },
      tenant: { id: "t1", status: "pending_setup" },
    });
    renderSignupPage();
    fillField(/your name/i, "Ada Lovelace");
    fillField(/work email/i, "ada@studio.com");
    fillField(/^password$/i, "password123");
    fillField(/^confirm$/i, "password123");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(signupMock.mock.calls[0]?.[0]).toEqual({
        name: "Ada Lovelace",
        email: "ada@studio.com",
        password: "password123",
        confirmPassword: "password123",
      });
    });
  });

  it("renders an inline email error when the email is already in use", async () => {
    signupMock.mockRejectedValue(new EmailInUseError());
    renderSignupPage();
    fillField(/your name/i, "Ada Lovelace");
    fillField(/work email/i, "ada@studio.com");
    fillField(/^password$/i, "password123");
    fillField(/^confirm$/i, "password123");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/email already in use/i)).toBeTruthy();
    });
  });
});
