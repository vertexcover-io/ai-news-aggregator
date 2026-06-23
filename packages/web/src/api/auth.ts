import type {
  AuthMeResponse,
  LoginRequest,
  LoginResponse,
  SignupRequest,
  SignupResponse,
} from "@newsletter/shared/types/tenant";
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
    super("email_in_use");
  }
}

/** 400 from signup/reset with zod field errors. */
export class FieldValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;
  constructor(fieldErrors: Record<string, string[]>) {
    super("invalid_body");
    this.fieldErrors = fieldErrors;
  }
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super("invalid_token");
  }
}

async function readFieldErrors(res: Response): Promise<Record<string, string[]>> {
  try {
    const body = (await res.json()) as { fieldErrors?: Record<string, string[]> };
    return body.fieldErrors ?? {};
  } catch {
    return {};
  }
}

export async function signup(body: SignupRequest): Promise<SignupResponse> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new EmailInUseError();
  if (res.status === 400) throw new FieldValidationError(await readFieldErrors(res));
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

export async function fetchMe(): Promise<AuthMeResponse> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`me: ${String(res.status)}`);
  return (await res.json()) as AuthMeResponse;
}

/** Always resolves ok — the server never reveals whether the email exists. */
export async function forgotPassword(email: string): Promise<void> {
  const res = await apiFetch("/api/auth/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`forgot: ${String(res.status)}`);
}

export async function resetPassword(body: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<void> {
  const res = await apiFetch("/api/auth/reset", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 400) {
    const fieldErrors = await readFieldErrors(res);
    if (Object.keys(fieldErrors).length > 0) {
      throw new FieldValidationError(fieldErrors);
    }
    throw new InvalidResetTokenError();
  }
  if (!res.ok) throw new Error(`reset: ${String(res.status)}`);
}
