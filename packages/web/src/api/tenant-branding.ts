import { apiFetch } from "./client";

export interface TenantBranding {
  name: string | null;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
  hasLogo: boolean;
  nav: {
    sources: boolean;
    mustRead: boolean;
    built: boolean;
  };
}

export async function getBranding(): Promise<TenantBranding> {
  const res = await apiFetch("/api/tenant/branding");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "failed to load branding");
  }
  return (await res.json()) as TenantBranding;
}
