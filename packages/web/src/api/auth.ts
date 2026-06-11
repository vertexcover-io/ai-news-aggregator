import type { SessionData } from "../hooks/useSession";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

export async function fetchSession(): Promise<SessionData> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
  return res.json();
}

export async function signup(data: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<{ next: string }> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "signup_failed", body);
  }
  return res.json();
}

export async function login(data: {
  email: string;
  password: string;
}): Promise<SessionData> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "login_failed", body);
  }
  return res.json();
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Logout failed");
}

export async function forgotPassword(email: string): Promise<void> {
  await fetch("/api/auth/forgot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(data: {
  token: string;
  password: string;
}): Promise<void> {
  const res = await fetch("/api/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "reset_failed", body);
  }
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}
