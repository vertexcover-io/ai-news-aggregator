import { PostHog } from "posthog-node";
import type { UserSettings } from "@newsletter/shared";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { resolvePostHogConfig, type PublicPostHogConfig } from "@newsletter/shared/analytics";

export interface AnalyticsCapture {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  /** Tenant whose PostHog settings should receive this event. Server-level
   * events without tenant context fall back to tenant 0 (the operator). */
  tenantId?: string;
}

export interface AnalyticsIdentify {
  distinctId: string;
  properties?: Record<string, unknown>;
  tenantId?: string;
}

type PostHogSettings = Pick<
  UserSettings,
  "posthogEnabled" | "posthogProjectToken" | "posthogHost"
>;

type SettingsProvider = (tenantId: string) => Promise<PostHogSettings | null>;

interface CachedConfig {
  config: PublicPostHogConfig;
  at: number;
}

let settingsProvider: SettingsProvider | null = null;
const configCache = new Map<string, CachedConfig>();
const clients = new Map<string, PostHog>();

const CONFIG_TTL_MS = 30_000;

export function configurePostHog(provider: SettingsProvider): void {
  settingsProvider = provider;
  configCache.clear();
}

export function refreshPostHogConfig(
  tenantId: string,
  settings: PostHogSettings | null,
): void {
  configCache.set(tenantId, {
    config: resolvePostHogConfig(settings),
    at: Date.now(),
  });
}

async function loadConfig(tenantId: string): Promise<PublicPostHogConfig> {
  const now = Date.now();
  const cached = configCache.get(tenantId);
  if (cached !== undefined && now - cached.at < CONFIG_TTL_MS) {
    return cached.config;
  }

  const settings = settingsProvider ? await settingsProvider(tenantId) : null;
  const config = resolvePostHogConfig(settings);
  configCache.set(tenantId, { config, at: now });
  return config;
}

function getClient(config: PublicPostHogConfig, tenantId: string): PostHog | null {
  if (!config.posthogEnabled || !config.posthogProjectToken || !config.posthogHost) {
    return null;
  }

  // posthog-node's exception autocapture registers process-GLOBAL
  // uncaughtException/unhandledRejection listeners, so a tenant-configured
  // client would receive every tenant's server errors. Only the operator's
  // (tenant 0) client may autocapture.
  const autocapture = tenantId === TENANT_ZERO_ID;
  const key = `${config.posthogProjectToken}\n${config.posthogHost}\n${autocapture}`;
  const existing = clients.get(key);
  if (existing !== undefined) return existing;

  const client = new PostHog(config.posthogProjectToken, {
    host: config.posthogHost,
    enableExceptionAutocapture: autocapture,
  });
  clients.set(key, client);
  return client;
}

export interface ExceptionContext {
  distinctId?: string;
  tenantId?: string;
  [k: string]: unknown;
}

export async function captureException(
  error: unknown,
  context?: ExceptionContext,
): Promise<void> {
  try {
    const { distinctId, tenantId, ...props } = context ?? {};
    const tid = tenantId ?? TENANT_ZERO_ID;
    const posthog = getClient(await loadConfig(tid), tid);
    if (posthog === null) return; // REQ-012 no-op when disabled
    const err = error instanceof Error ? error : new Error(String(error));
    posthog.captureException(err, distinctId ?? "api-server", props);
  } catch {
    console.warn("[analytics] captureException failed — misconfigured or network error"); // REQ-013/EDGE-001
  }
}

export async function captureAnalytics(event: AnalyticsCapture): Promise<void> {
  try {
    const { tenantId, ...capture } = event;
    const tid = tenantId ?? TENANT_ZERO_ID;
    const posthog = getClient(await loadConfig(tid), tid);
    posthog?.capture(capture);
  } catch {
    console.warn("[analytics] captureAnalytics failed — misconfigured or network error");
  }
}

export async function identifyAnalytics(person: AnalyticsIdentify): Promise<void> {
  try {
    const { tenantId, ...identify } = person;
    const tid = tenantId ?? TENANT_ZERO_ID;
    const posthog = getClient(await loadConfig(tid), tid);
    posthog?.identify(identify);
  } catch {
    console.warn("[analytics] identifyAnalytics failed — misconfigured or network error");
  }
}

export async function shutdownAnalytics(): Promise<void> {
  const existing = [...clients.values()];
  clients.clear();
  await Promise.all(existing.map((c) => c.shutdown()));
}

export function resetAnalyticsForTest(): void {
  settingsProvider = null;
  configCache.clear();
  clients.clear();
}
