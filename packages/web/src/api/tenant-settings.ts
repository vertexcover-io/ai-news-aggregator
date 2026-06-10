import { apiFetchAdmin } from "./client";

export interface NotificationsConfig {
  notifyEmail: string | null;
  slackWebhook: Record<string, string> | null;
}

export interface FeatureFlags {
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
}

export async function getNotifications(): Promise<NotificationsConfig> {
  const res = await apiFetchAdmin("/api/settings/notifications");
  if (!res.ok) throw new Error("Failed to fetch notification settings");
  return res.json() as Promise<NotificationsConfig>;
}

export async function getFeatures(): Promise<FeatureFlags> {
  const res = await apiFetchAdmin("/api/settings/features");
  if (!res.ok) throw new Error("Failed to fetch feature flags");
  return res.json() as Promise<FeatureFlags>;
}
