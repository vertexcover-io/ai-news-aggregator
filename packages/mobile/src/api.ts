/**
 * API client for the SEPARATE extension bearer-token path (`/api/extension/*`),
 * reused verbatim by the mobile app:
 *
 *   POST /api/extension/login        { email, password } -> { token, expiresAt, user }
 *   POST /api/extension/submissions  { url, title? }     -> SubmitResponse  (Bearer)
 *
 * Native iOS/Android fetch is NOT subject to CORS, so the API's
 * `chrome-extension://`-scoped CORS gate does not block these requests — no
 * backend change is required. The token embeds {userId, tenantId, role}, so the
 * submission lands in the submitter's tenant exactly like the extension path.
 */
import { API_BASE } from "./config";

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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({ error: "unknown" }))) as {
    error?: string;
  };
  throw new ApiError(body.error ?? "unknown", res.status);
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
    return readError(res);
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
    return readError(res);
  }
  return res.json() as Promise<SubmitResponse>;
}
