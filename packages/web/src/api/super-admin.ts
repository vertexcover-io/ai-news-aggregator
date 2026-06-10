import { apiFetch } from "./client";

export interface SuperAdminTenant {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  customDomain: string | null;
  userCount: number;
  subscriberCount: number;
  lastRunAt: string | null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function listTenants(): Promise<SuperAdminTenant[]> {
  const res = await apiFetch("/api/super-admin/tenants");
  if (!res.ok) throw new Error(await errorMessage(res, "failed to load tenants"));
  const body = (await res.json()) as { tenants: SuperAdminTenant[] };
  return body.tenants;
}

export async function impersonate(tenantId: string): Promise<{ tenantId: string }> {
  const res = await apiFetch(
    `/api/super-admin/impersonate/${encodeURIComponent(tenantId)}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(await errorMessage(res, "impersonation failed"));
  return (await res.json()) as { tenantId: string };
}

export async function exitImpersonation(): Promise<void> {
  const res = await apiFetch("/api/super-admin/impersonate/exit", {
    method: "POST",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "exit failed"));
}
