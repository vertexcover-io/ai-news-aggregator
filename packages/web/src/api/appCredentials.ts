/**
 * App-credentials API client (Phase 5, REQ-019): super-admin-only endpoints
 * for platform-level credential status and Apify token management.
 *
 * All endpoints require a super_admin session (requireSuperAdmin on the API
 * side). Never returns secret material — only configured/updatedAt.
 */
import { apiFetch } from "./client";

export interface ApifyCredentialStatus {
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

/** Partial shape of the GET /api/super/app-credentials response. */
export interface AppCredentialsStatusResponse {
  readonly apify: ApifyCredentialStatus;
}

/** GET /api/super/app-credentials — status projection (no secrets). */
export async function getAppCredentialsStatus(): Promise<AppCredentialsStatusResponse> {
  const res = await apiFetch("/api/super/app-credentials");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `app-credentials status: ${String(res.status)}`);
  }
  return (await res.json()) as AppCredentialsStatusResponse;
}

/** PUT /api/super/app-credentials/apify — upsert the Apify API token. */
export async function putApifyToken(
  apiToken: string,
): Promise<{ configured: boolean; updatedAt: string }> {
  const res = await apiFetch("/api/super/app-credentials/apify", {
    method: "PUT",
    body: JSON.stringify({ apiToken }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `put apify token: ${String(res.status)}`);
  }
  return (await res.json()) as { configured: boolean; updatedAt: string };
}

/** DELETE /api/super/app-credentials/apify — remove the Apify API token row. */
export async function deleteApifyToken(): Promise<{ ok: boolean; removed: boolean }> {
  const res = await apiFetch("/api/super/app-credentials/apify", {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `delete apify token: ${String(res.status)}`);
  }
  return (await res.json()) as { ok: boolean; removed: boolean };
}
