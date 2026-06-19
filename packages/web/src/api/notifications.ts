/**
 * Notification settings + feature flags API client (P16, REQ-092/093) —
 * backs the Settings page's Notifications and Features panels.
 *
 * REQ-092: the Slack webhook is write-only. `putNotificationSettings` sends
 * the raw URL only when the operator typed one (omitted = keep stored,
 * null = clear); responses only ever carry `slackWebhookSet`.
 */
import type {
  TenantFeatureFlagsWire,
  TenantNotificationSettingsWire,
} from "@newsletter/shared/types/tenant";
import { apiFetchAdmin } from "./client";

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? fallback);
}

export interface NotificationSettingsUpdate {
  notifyEmail: string | null;
  /** Omit to keep the stored webhook; null clears it; a URL replaces it. */
  slackWebhook?: string | null;
  notifyReviewReady: boolean;
  notifyErrors: boolean;
}

export async function getNotificationSettings(): Promise<TenantNotificationSettingsWire> {
  const res = await apiFetchAdmin("/api/settings/notifications");
  if (!res.ok) await readError(res, "Failed to load notification settings");
  return (await res.json()) as TenantNotificationSettingsWire;
}

export async function putNotificationSettings(
  update: NotificationSettingsUpdate,
): Promise<TenantNotificationSettingsWire> {
  const res = await apiFetchAdmin("/api/settings/notifications", {
    method: "PUT",
    body: JSON.stringify(update),
  });
  if (!res.ok) await readError(res, "Failed to save notification settings");
  return (await res.json()) as TenantNotificationSettingsWire;
}

export async function getFeatureFlags(): Promise<TenantFeatureFlagsWire> {
  const res = await apiFetchAdmin("/api/settings/features");
  if (!res.ok) await readError(res, "Failed to load feature flags");
  return (await res.json()) as TenantFeatureFlagsWire;
}

export async function putFeatureFlags(
  flags: TenantFeatureFlagsWire,
): Promise<TenantFeatureFlagsWire> {
  const res = await apiFetchAdmin("/api/settings/features", {
    method: "PUT",
    body: JSON.stringify(flags),
  });
  if (!res.ok) await readError(res, "Failed to save feature flags");
  return (await res.json()) as TenantFeatureFlagsWire;
}
