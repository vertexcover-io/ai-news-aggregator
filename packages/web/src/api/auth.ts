import type {
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  ResetPasswordRequest,
  SignupRequest,
  SignupResponse,
} from "@newsletter/shared/types";
import { apiFetch } from "./client";

export class LoginFailedError extends Error {
  constructor() {
    super("invalid_credentials");
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
  }
}

export class EmailInUseError extends Error {
  constructor() {
    super("email already in use");
  }
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super("invalid_or_expired");
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super("rate_limited");
  }
}

export async function signup(body: SignupRequest): Promise<SignupResponse> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new EmailInUseError();
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`signup: ${String(res.status)}`);
  return (await res.json()) as SignupResponse;
}

export async function login(body: LoginRequest): Promise<LoginResponse> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new LoginFailedError();
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`login: ${String(res.status)}`);
  return (await res.json()) as LoginResponse;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`me: ${String(res.status)}`);
  return (await res.json()) as MeResponse;
}

export async function forgotPassword(
  body: ForgotPasswordRequest,
): Promise<void> {
  const res = await apiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`forgot-password: ${String(res.status)}`);
}

export async function resetPassword(
  body: ResetPasswordRequest,
): Promise<void> {
  const res = await apiFetch("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 400) throw new InvalidResetTokenError();
  if (!res.ok) throw new Error(`reset-password: ${String(res.status)}`);
}
