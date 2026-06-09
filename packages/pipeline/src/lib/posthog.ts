import { PostHog } from "posthog-node";
import { resolvePostHogConfig } from "@newsletter/shared/analytics";

let client: PostHog | null = null;
let initialized = false;

function getClient(): PostHog | null {
  if (initialized) return client;
  initialized = true;
  const cfg = resolvePostHogConfig(null); // env-only (no per-job settings at process scope, deliberate per D-002)
  if (!cfg.posthogEnabled || !cfg.posthogProjectToken || !cfg.posthogHost) return (client = null);
  client = new PostHog(cfg.posthogProjectToken, {
    host: cfg.posthogHost,
    enableExceptionAutocapture: true,
  });
  return client;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  try {
    const ph = getClient();
    if (ph === null) return;
    const err = error instanceof Error ? error : new Error(String(error));
    ph.captureException(err, "pipeline-worker", context); // no await flush — REQ-015
  } catch {
    console.warn("[posthog] captureException failed");
  }
}

export function capturePipelineEvent(event: string, properties?: Record<string, unknown>): void {
  try {
    const ph = getClient();
    if (ph === null) return;
    ph.capture({ distinctId: "pipeline-worker", event, properties });
  } catch {
    console.warn("[posthog] capture failed");
  }
}

export async function shutdownPostHog(): Promise<void> {
  const c = client;
  client = null;
  initialized = false;
  if (c !== null) await c.shutdown();
}

export function resetPostHogForTest(): void {
  client = null;
  initialized = false;
}
