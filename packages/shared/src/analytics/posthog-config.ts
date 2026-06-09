import type { UserSettings } from "../types/settings.js";

export interface PublicPostHogConfig {
  posthogEnabled: boolean;
  posthogProjectToken: string | null;
  posthogHost: string | null;
}

export type PostHogSettings = Pick<
  UserSettings,
  "posthogEnabled" | "posthogProjectToken" | "posthogHost"
>;

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function envEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.POSTHOG_ENABLED ?? "true").toLowerCase() !== "false";
}

export function resolvePostHogConfig(
  settings: PostHogSettings | null,
  env: NodeJS.ProcessEnv = process.env,
): PublicPostHogConfig {
  if (settings !== null) {
    const token = clean(settings.posthogProjectToken);
    const host = clean(settings.posthogHost);
    const enabled = settings.posthogEnabled && token !== null && host !== null;
    return {
      posthogEnabled: enabled,
      posthogProjectToken: enabled ? token : null,
      posthogHost: enabled ? host : null,
    };
  }

  const token = clean(env.POSTHOG_PROJECT_TOKEN ?? env.POSTHOG_API_KEY);
  const host = clean(env.POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST;
  const enabled = envEnabled(env) && token !== null;
  return {
    posthogEnabled: enabled,
    posthogProjectToken: enabled ? token : null,
    posthogHost: enabled ? host : null,
  };
}
