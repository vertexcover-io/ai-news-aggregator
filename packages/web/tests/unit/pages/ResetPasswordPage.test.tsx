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
  return { ...actual, resetPassword: vi.fn() };
});

import { resetPassword, InvalidResetTokenError } from "../../../src/api/auth";
import { ResetPasswordPage } from "../../../src/pages/ResetPasswordPage";

const mockReset = vi.mocked(resetPassword);

function renderPage(initialPath: string): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ResetPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  mockReset.mockReset();
});
afterEach(cleanup);

describe("ResetPasswordPage", () => {
  it("shows an invalid-link message when token is missing", () => {
    renderPage("/reset");
    expect(screen.getByText("Invalid reset link")).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("blocks submission and shows mismatch error when passwords differ", async () => {
    renderPage("/reset?token=abc");
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /update password/i }),
    );
    expect(await screen.findByText("Passwords don't match.")).toBeTruthy();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it("submits with the token from the query string and redirects on success", async () => {
    mockReset.mockResolvedValue(undefined);
    renderPage("/reset?token=tok123");
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /update password/i }),
    );

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledWith({
        token: "tok123",
        password: "longpassword1",
        confirmPassword: "longpassword1",
      });
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/admin");
    });
  });

  it("shows an expired-token error when reset returns 400", async () => {
    mockReset.mockRejectedValue(new InvalidResetTokenError());
    renderPage("/reset?token=stale");
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /update password/i }),
    );
    expect(
      await screen.findByText(/invalid or has expired/i),
    ).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
