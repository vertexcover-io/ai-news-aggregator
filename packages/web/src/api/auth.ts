import { apiFetch } from "./client";

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface SignupResponse {
  ok: true;
  tenantId: string;
}

export class EmailInUseError extends Error {
  constructor() {
    super("email already in use");
    this.name = "EmailInUseError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("invalid_credentials");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super("invalid_or_expired_token");
    this.name = "InvalidResetTokenError";
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function signup(input: SignupInput): Promise<SignupResponse> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 409) throw new EmailInUseError();
  if (!res.ok) throw new Error(await errorMessage(res, "signup failed"));
  return (await res.json()) as SignupResponse;
}

export async function login(input: LoginInput): Promise<void> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new InvalidCredentialsError();
  if (!res.ok) throw new Error(await errorMessage(res, "login failed"));
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function forgotPassword(email: string): Promise<void> {
  const res = await apiFetch("/api/auth/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "request failed"));
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const res = await apiFetch("/api/auth/reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 400) throw new InvalidResetTokenError();
  if (!res.ok) throw new Error(await errorMessage(res, "reset failed"));
}
