import { apiFetch } from "./client";

export interface PublicAnalyticsConfig {
  posthogEnabled: boolean;
  posthogProjectToken: string | null;
  posthogHost: string | null;
}

export async function fetchAnalyticsConfig(): Promise<PublicAnalyticsConfig> {
  const res = await apiFetch("/api/public/analytics-config");
  if (!res.ok) {
    return {
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    };
  }
  return (await res.json()) as PublicAnalyticsConfig;
}

