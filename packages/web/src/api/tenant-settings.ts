import { apiFetch } from "./client";

export interface TenantSettings {
  id: string;
  slug: string;
  status: string;
  name: string | null;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  canonEnabled: boolean;
  deliverabilityEnabled: boolean;
  evalEnabled: boolean;
  notificationEmail: string | null;
  slackWebhookConfigured: boolean;
}

export interface TenantSettingsPatch {
  name?: string | null;
  headline?: string | null;
  topicStrip?: string | null;
  subtagline?: string | null;
  canonEnabled?: boolean;
  deliverabilityEnabled?: boolean;
  evalEnabled?: boolean;
  notificationEmail?: string | null;
  slackWebhook?: string | null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function getTenantSettings(): Promise<TenantSettings> {
  const res = await apiFetch("/api/tenant-settings");
  if (!res.ok) throw new Error(await errorMessage(res, "failed to load settings"));
  return (await res.json()) as TenantSettings;
}

export async function patchTenantSettings(
  patch: TenantSettingsPatch,
): Promise<TenantSettings> {
  const res = await apiFetch("/api/tenant-settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "failed to save settings"));
  return (await res.json()) as TenantSettings;
}
