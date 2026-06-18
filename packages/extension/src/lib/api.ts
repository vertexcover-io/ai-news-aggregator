const API_BASE =
  (typeof import.meta.env !== "undefined"
    ? (import.meta.env.VITE_API_BASE as string | undefined)
    : undefined) ?? "http://localhost:3000";

export interface LoginResponse {
  token: string;
  expiresAt: number;
}

export interface SubmitResponse {
  id: string;
  url: string;
  sourceType: string;
  alreadyExisted: boolean;
}

export async function login(password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/extension/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
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
