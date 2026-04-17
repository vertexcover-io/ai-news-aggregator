import type {
  AdminLoginRequest,
  AdminLoginResponse,
  AdminMeResponse,
} from "@newsletter/shared";
import { apiFetch } from "./client";

export class LoginFailedError extends Error {
  constructor() {
    super("invalid_password");
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
  }
}

export async function login(
  body: AdminLoginRequest,
): Promise<AdminLoginResponse> {
  const res = await apiFetch("/api/admin/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new LoginFailedError();
  if (!res.ok) throw new Error(`login: ${String(res.status)}`);
  return (await res.json()) as AdminLoginResponse;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/admin/logout", { method: "POST" });
}

export async function fetchMe(): Promise<AdminMeResponse> {
  const res = await apiFetch("/api/admin/me");
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`me: ${String(res.status)}`);
  return (await res.json()) as AdminMeResponse;
}
