import type { TenantSelect } from "@newsletter/shared/db";
import { apiFetch } from "./client";

export async function listTenants(): Promise<TenantSelect[]> {
  const res = await apiFetch("/api/super/tenants");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error(typeof body?.error === "string" ? body.error : "Failed to fetch tenants");
  }
  return (await res.json()) as TenantSelect[];
}

export async function impersonateTenant(
  tenantId: string,
): Promise<{ ok: true; tenantId: string; tenantName: string }> {
  const res = await apiFetch(`/api/super/impersonate/${tenantId}`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error(typeof body?.error === "string" ? body.error : "Failed to impersonate tenant");
  }
  return (await res.json()) as { ok: true; tenantId: string; tenantName: string };
}

export async function exitImpersonation(): Promise<{ ok: true }> {
  const res = await apiFetch("/api/super/impersonate/exit", {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error(typeof body?.error === "string" ? body.error : "Failed to exit impersonation");
  }
  return (await res.json()) as { ok: true };
}
