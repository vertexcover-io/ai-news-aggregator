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
  return { ...actual, login: vi.fn() };
});

import { login, InvalidCredentialsError } from "../../../src/api/auth";
import { TenantLoginPage } from "../../../src/pages/TenantLoginPage";

const mockLogin = vi.mocked(login);

function renderPage(initialPath = "/login"): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TenantLoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  mockLogin.mockReset();
});
afterEach(cleanup);

describe("TenantLoginPage", () => {
  it("renders email and password fields", () => {
    renderPage();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("submits credentials and redirects to /admin on success", async () => {
    mockLogin.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@studio.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: "ada@studio.com",
        password: "longpassword1",
      });
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/admin");
    });
  });

  it("honors the ?next param on success", async () => {
    mockLogin.mockResolvedValue(undefined);
    renderPage("/login?next=%2Fadmin%2Fsettings");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@studio.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/admin/settings");
    });
  });

  it("shows an error on invalid credentials", async () => {
    mockLogin.mockRejectedValue(new InvalidCredentialsError());
    renderPage();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@studio.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText("Incorrect email or password."),
    ).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
