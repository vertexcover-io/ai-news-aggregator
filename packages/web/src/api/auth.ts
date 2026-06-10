import type {
  SignupResponse,
  LoginRequest,
  LoginResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  SessionMeResponse,
} from "@newsletter/shared";
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

export class DuplicateEmailError extends Error {
  constructor() {
    super("email_in_use");
  }
}

export async function signup(body: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<SignupResponse> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new DuplicateEmailError();
  if (!res.ok) throw new Error(`signup: ${String(res.status)}`);
  return (await res.json()) as SignupResponse;
}

export async function login(body: LoginRequest): Promise<LoginResponse> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new LoginFailedError();
  if (!res.ok) throw new Error(`login: ${String(res.status)}`);
  return (await res.json()) as LoginResponse;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function forgotPassword(
  body: ForgotPasswordRequest,
): Promise<void> {
  await apiFetch("/api/auth/forgot", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function resetPassword(
  body: ResetPasswordRequest,
): Promise<void> {
  await apiFetch("/api/auth/reset", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchMe(): Promise<SessionMeResponse> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`me: ${String(res.status)}`);
  return (await res.json()) as SessionMeResponse;
}
