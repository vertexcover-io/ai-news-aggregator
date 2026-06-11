/**
 * Super-admin console API (P6): tenant list + audited impersonation.
 * All endpoints require a super_admin session (requireSuperAdmin).
 */
import type { SessionTenant } from "@newsletter/shared/types/tenant";
import { apiFetch } from "./client";

export interface SuperTenantSummary extends SessionTenant {
  createdAt: string;
}

export async function listTenants(): Promise<SuperTenantSummary[]> {
  const res = await apiFetch("/api/super/tenants");
  if (!res.ok) throw new Error(`tenants: ${String(res.status)}`);
  const body = (await res.json()) as { tenants: SuperTenantSummary[] };
  return body.tenants;
}

/** Starts impersonation: sets the short-lived impersonation cookie (REQ-101). */
export async function impersonateTenant(
  tenantId: string,
): Promise<SuperTenantSummary> {
  const res = await apiFetch(`/api/super/impersonate/${tenantId}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`impersonate: ${String(res.status)}`);
  const body = (await res.json()) as { tenant: SuperTenantSummary };
  return body.tenant;
}

/** One-click exit: clears the impersonation cookie, audited (REQ-102/103). */
export async function exitImpersonation(): Promise<void> {
  const res = await apiFetch("/api/super/impersonate/exit", { method: "POST" });
  if (!res.ok) throw new Error(`exit impersonation: ${String(res.status)}`);
}
