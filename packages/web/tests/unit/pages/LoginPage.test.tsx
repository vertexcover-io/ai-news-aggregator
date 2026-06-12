import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginPage } from "../../../src/pages/LoginPage";
import { login, fetchMe, LoginFailedError, UnauthenticatedError } from "../../../src/api/auth";

vi.mock("../../../src/api/auth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/auth")>(
    "../../../src/api/auth",
  );
  return { ...actual, login: vi.fn(), fetchMe: vi.fn() };
});

const loginMock = vi.mocked(login);
const fetchMeMock = vi.mocked(fetchMe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLoginPage(initialEntry = "/login"): ReturnType<typeof render> {
  fetchMeMock.mockRejectedValue(new UnauthenticatedError());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<div>Admin home</div>} />
          <Route path="/admin/settings" element={<div>Settings page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function submitCredentials(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginPage", () => {
  it("submits email and password and navigates to /admin by default", async () => {
    loginMock.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "ada@studio.com", role: "tenant_admin" },
    });
    renderLoginPage();
    submitCredentials("ada@studio.com", "password123");

    await waitFor(() => {
      expect(loginMock.mock.calls[0]?.[0]).toEqual({
        email: "ada@studio.com",
        password: "password123",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Admin home")).toBeTruthy();
    });
  });

  it("honours the ?next= redirect after login", async () => {
    loginMock.mockResolvedValue({
      user: { id: "u1", name: "Ada", email: "ada@studio.com", role: "tenant_admin" },
    });
    renderLoginPage(`/login?next=${encodeURIComponent("/admin/settings")}`);
    submitCredentials("ada@studio.com", "password123");

    await waitFor(() => {
      expect(screen.getByText("Settings page")).toBeTruthy();
    });
  });

  it("shows an error on invalid credentials", async () => {
    loginMock.mockRejectedValue(new LoginFailedError());
    renderLoginPage();
    submitCredentials("ada@studio.com", "wrong-password");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /incorrect email or password/i,
      );
    });
  });

  it("links to signup and forgot-password", () => {
    renderLoginPage();
    expect(
      screen.getByRole("link", { name: /create an account/i }).getAttribute("href"),
    ).toBe("/signup");
    expect(
      screen.getByRole("link", { name: /forgot/i }).getAttribute("href"),
    ).toBe("/forgot-password");
  });
});
