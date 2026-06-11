import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { apiFetch } from "./client";

export async function getBranding(): Promise<TenantBranding> {
  const res = await apiFetch("/api/branding");
  if (!res.ok) throw new Error(`getBranding: ${String(res.status)}`);
  return (await res.json()) as TenantBranding;
}
