import posthog from "posthog-js";
import { fetchAnalyticsConfig } from "../api/analyticsConfig";

let initialized = false;
let initKey: string | null = null;

export async function initBrowserAnalytics(): Promise<boolean> {
  try {
    const config = await fetchAnalyticsConfig();
    if (
      !config.posthogEnabled ||
      !config.posthogProjectToken ||
      !config.posthogHost
    ) {
      initialized = false;
      initKey = null;
      return false;
    }

    const nextKey = `${config.posthogProjectToken}\n${config.posthogHost}`;
    if (initialized && initKey === nextKey) return true;

    posthog.init(config.posthogProjectToken, {
      api_host: config.posthogHost,
      defaults: "2026-01-30",
      capture_pageview: "history_change",
      capture_pageleave: "if_capture_pageview",
      autocapture: true,
      disable_session_recording: true,
      mask_all_element_attributes: true,
      property_denylist: ["email", "password"],
    });
    initialized = true;
    initKey = nextKey;
    return true;
  } catch {
    initialized = false;
    initKey = null;
    return false;
  }
}

export function captureBrowserEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function resetBrowserAnalyticsForTest(): void {
  initialized = false;
  initKey = null;
}
