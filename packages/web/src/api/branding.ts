import type {
  BrandingSettings,
  TenantBranding,
} from "@newsletter/shared/types/tenant";
import { apiFetch, apiFetchAdmin } from "./client";

export async function getBranding(): Promise<TenantBranding> {
  const res = await apiFetch("/api/branding");
  if (!res.ok) throw new Error(`getBranding: ${String(res.status)}`);
  return (await res.json()) as TenantBranding;
}

/* ── Admin branding settings (FIX #1) ──────────────────────────────────── */

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? fallback);
}

export interface BrandingSettingsUpdate {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const res = await apiFetchAdmin("/api/settings/branding");
  if (!res.ok) await readError(res, "Failed to load branding");
  return (await res.json()) as BrandingSettings;
}

export async function putBrandingSettings(
  update: BrandingSettingsUpdate,
): Promise<BrandingSettings> {
  const res = await apiFetchAdmin("/api/settings/branding", {
    method: "PUT",
    body: JSON.stringify(update),
  });
  if (!res.ok) await readError(res, "Failed to save branding");
  return (await res.json()) as BrandingSettings;
}

/** Raw-bytes logo upload; the API sniffs the type and rejects bad files. */
export async function uploadBrandingLogo(
  file: Blob,
): Promise<{ ok: true; contentType: string }> {
  // apiFetch forces a JSON content-type; logo upload sends raw bytes, so it
  // uses fetch directly with credentials (mirrors api/onboarding.ts uploadLogo).
  const res = await fetch("/api/settings/branding/logo", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!res.ok) await readError(res, "Logo upload failed");
  return (await res.json()) as { ok: true; contentType: string };
}
