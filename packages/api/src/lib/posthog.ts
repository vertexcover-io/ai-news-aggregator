import { PostHog } from "posthog-node";
import type { UserSettings } from "@newsletter/shared";
import { resolvePostHogConfig, type PublicPostHogConfig } from "./posthog-config.js";

export interface AnalyticsCapture {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export interface AnalyticsIdentify {
  distinctId: string;
  properties?: Record<string, unknown>;
}

type SettingsProvider = () => Promise<Pick<
  UserSettings,
  "posthogEnabled" | "posthogProjectToken" | "posthogHost"
> | null>;

let settingsProvider: SettingsProvider | null = null;
let cachedConfig: PublicPostHogConfig | null = null;
let cachedConfigAt = 0;
let client: PostHog | null = null;
let clientKey: string | null = null;

const CONFIG_TTL_MS = 30_000;

export function configurePostHog(provider: SettingsProvider): void {
  settingsProvider = provider;
  cachedConfig = null;
  cachedConfigAt = 0;
}

export function refreshPostHogConfig(
  settings: Pick<UserSettings, "posthogEnabled" | "posthogProjectToken" | "posthogHost"> | null,
): void {
  cachedConfig = resolvePostHogConfig(settings);
  cachedConfigAt = Date.now();
  if (!cachedConfig.posthogEnabled) {
    void shutdownAnalytics();
  }
}

async function loadConfig(): Promise<PublicPostHogConfig> {
  const now = Date.now();
  if (cachedConfig !== null && now - cachedConfigAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }

  const settings = settingsProvider ? await settingsProvider() : null;
  cachedConfig = resolvePostHogConfig(settings);
  cachedConfigAt = now;
  return cachedConfig;
}

function getClient(config: PublicPostHogConfig): PostHog | null {
  if (!config.posthogEnabled || !config.posthogProjectToken || !config.posthogHost) {
    return null;
  }

  const nextKey = `${config.posthogProjectToken}\n${config.posthogHost}`;
  if (client !== null && clientKey === nextKey) return client;

  if (client !== null) void client.shutdown();
  client = new PostHog(config.posthogProjectToken, {
    host: config.posthogHost,
    enableExceptionAutocapture: true,
  });
  clientKey = nextKey;
  return client;
}

export async function captureAnalytics(event: AnalyticsCapture): Promise<void> {
  try {
    const posthog = getClient(await loadConfig());
    posthog?.capture(event);
  } catch {
    // Analytics must never affect product flows.
  }
}

export async function identifyAnalytics(person: AnalyticsIdentify): Promise<void> {
  try {
    const posthog = getClient(await loadConfig());
    posthog?.identify(person);
  } catch {
    // Analytics must never affect product flows.
  }
}

export async function shutdownAnalytics(): Promise<void> {
  const existing = client;
  client = null;
  clientKey = null;
  if (existing !== null) await existing.shutdown();
}

export function resetAnalyticsForTest(): void {
  settingsProvider = null;
  cachedConfig = null;
  cachedConfigAt = 0;
  client = null;
  clientKey = null;
}
