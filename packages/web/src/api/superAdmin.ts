import type { SessionTenant } from "@newsletter/shared/types";
import { apiFetchAdmin } from "./client";

export type SuperAdminTenantStatus = SessionTenant["status"];

export interface SuperAdminTenant {
  id: string;
  slug: string;
  name: string;
  status: SuperAdminTenantStatus;
  createdAt: string;
}

export interface ImpersonateResult {
  impersonating: boolean;
  tenant: Pick<SessionTenant, "id" | "slug" | "name" | "status">;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? fallback);
}

export async function listTenants(): Promise<SuperAdminTenant[]> {
  const res = await apiFetchAdmin("/api/super-admin/tenants");
  if (!res.ok) await readError(res, "Failed to fetch tenants");
  const body = (await res.json()) as { tenants: SuperAdminTenant[] };
  return body.tenants;
}

export async function impersonateTenant(
  tenantId: string,
): Promise<ImpersonateResult> {
  const res = await apiFetchAdmin(`/api/super-admin/impersonate/${tenantId}`, {
    method: "POST",
  });
  if (!res.ok) await readError(res, "Failed to impersonate tenant");
  return (await res.json()) as ImpersonateResult;
}

export async function exitImpersonation(): Promise<void> {
  const res = await apiFetchAdmin("/api/super-admin/exit-impersonation", {
    method: "POST",
  });
  if (!res.ok) await readError(res, "Failed to exit impersonation");
}
