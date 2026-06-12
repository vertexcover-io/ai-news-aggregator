import { apiFetch } from "./client";

export interface TenantFlags {
  canon: boolean;
  built: boolean;
  deliverability: boolean;
}

export interface TenantConfig {
  name: string;
  slug: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
  flags: TenantFlags;
}

export const TENANT_LOGO_PATH = "/api/public/tenant-logo";

export function tenantLogoUrl(logoVersion: number): string {
  return `${TENANT_LOGO_PATH}?v=${String(logoVersion)}`;
}

/** Null on 404: the app host carries no public tenant surface. */
export async function getTenantConfig(): Promise<TenantConfig | null> {
  const res = await apiFetch("/api/public/tenant-config");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getTenantConfig: ${String(res.status)}`);
  return (await res.json()) as TenantConfig;
}
