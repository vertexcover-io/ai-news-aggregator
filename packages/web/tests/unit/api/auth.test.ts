import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  EmailInUseError,
  InvalidCredentialsError,
  InvalidResetTokenError,
} from "../../../src/api/auth";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signup", () => {
  it("POSTs /api/auth/signup and returns tenantId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, tenantId: "t-1" }), {
        status: 201,
      }),
    );
    const out = await signup({
      name: "A",
      email: "a@b.co",
      password: "password1",
      confirmPassword: "password1",
    });
    expect(out.tenantId).toBe("t-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/signup");
    expect(init.method).toBe("POST");
  });

  it("throws EmailInUseError on 409", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "email already in use" }), {
        status: 409,
      }),
    );
    await expect(
      signup({
        name: "A",
        email: "a@b.co",
        password: "password1",
        confirmPassword: "password1",
      }),
    ).rejects.toBeInstanceOf(EmailInUseError);
  });
});

describe("login", () => {
  it("throws InvalidCredentialsError on 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
      }),
    );
    await expect(login({ email: "a@b.co", password: "x" })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("resolves on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      login({ email: "a@b.co", password: "x" }),
    ).resolves.toBeUndefined();
  });
});

describe("logout / forgotPassword", () => {
  it("logout POSTs without throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await logout();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/auth/logout");
  });

  it("forgotPassword sends email in body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await forgotPassword("a@b.co");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/forgot");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co" });
  });
});

describe("resetPassword", () => {
  it("throws InvalidResetTokenError on 400", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_or_expired_token" }), {
        status: 400,
      }),
    );
    await expect(
      resetPassword({ token: "t", password: "password1", confirmPassword: "password1" }),
    ).rejects.toBeInstanceOf(InvalidResetTokenError);
  });
});
