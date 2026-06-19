const API_BASE =
  (typeof import.meta.env !== "undefined"
    ? (import.meta.env.VITE_API_BASE as string | undefined)
    : undefined) ?? "http://localhost:3000";

export interface LoginResponse {
  token: string;
  expiresAt: number;
  user: { role: string; tenantId: string };
}

export interface SubmitResponse {
  id: number;
  url: string;
  title: string;
  sourceType: string;
  alreadyExisted: boolean;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/extension/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "unknown" }))) as {
      error: string;
    };
    throw Object.assign(new Error(err.error), { status: res.status });
  }
  return res.json() as Promise<LoginResponse>;
}

export async function submit(
  url: string,
  title: string | undefined,
  token: string,
): Promise<SubmitResponse> {
  const res = await fetch(`${API_BASE}/api/extension/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, title }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "unknown" }))) as {
      error: string;
    };
    throw Object.assign(new Error(err.error), { status: res.status });
  }
  return res.json() as Promise<SubmitResponse>;
}
