import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../../../src/api/auth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/api/auth")>(
      "../../../src/api/auth",
    );
  return { ...actual, signup: vi.fn() };
});

import { signup, EmailInUseError } from "../../../src/api/auth";
import { SignupPage } from "../../../src/pages/SignupPage";

const mockSignup = vi.mocked(signup);

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fill(label: RegExp | string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  navigateMock.mockReset();
  mockSignup.mockReset();
});
afterEach(cleanup);

describe("SignupPage", () => {
  it("renders the account fields", () => {
    renderPage();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByLabelText("Work email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm")).toBeTruthy();
  });

  it("blocks submission and shows mismatch error when passwords differ", async () => {
    renderPage();
    fill("Your name", "Ada");
    fill("Work email", "ada@studio.com");
    fill("Password", "longpassword1");
    fill("Confirm", "different123");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Passwords don't match.")).toBeTruthy();
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it("submits and redirects to onboarding on success", async () => {
    mockSignup.mockResolvedValue({ ok: true, tenantId: "t1" });
    renderPage();
    fill("Your name", "Ada");
    fill("Work email", "ada@studio.com");
    fill("Password", "longpassword1");
    fill("Confirm", "longpassword1");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockSignup).toHaveBeenCalledWith({
        name: "Ada",
        email: "ada@studio.com",
        password: "longpassword1",
        confirmPassword: "longpassword1",
      });
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("shows a duplicate-email error when signup returns 409", async () => {
    mockSignup.mockRejectedValue(new EmailInUseError());
    renderPage();
    fill("Your name", "Ada");
    fill("Work email", "taken@studio.com");
    fill("Password", "longpassword1");
    fill("Confirm", "longpassword1");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText("That email is already registered."),
    ).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
