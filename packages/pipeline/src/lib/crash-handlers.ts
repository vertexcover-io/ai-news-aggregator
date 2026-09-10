import { captureException, shutdownPostHog } from "@pipeline/lib/posthog.js";
import { recordIncident } from "@pipeline/lib/incident.js";
import { createLogger } from "@newsletter/shared/logger";
import { buildExceptionTags } from "@newsletter/shared/errors";

const logger = createLogger("pipeline:crash");

/**
 * Creates a fatal crash handler for uncaughtException / unhandledRejection.
 * Captures the error to PostHog, flushes (bounded by shutdownPostHog), then exits 1.
 */
const SHUTDOWN_TIMEOUT_MS = 2000;

export function createFatalHandler(label: string): (err: unknown) => Promise<void> {
  return async (err: unknown): Promise<void> => {
    logger.fatal(
      { event: label, error: err instanceof Error ? err.message : String(err) },
      label,
    );
    captureException(err, {
      fatal: true,
      source: label,
      ...buildExceptionTags(err, { sourcePackage: "pipeline", source: label }),
    });
    recordIncident({ err, sourcePackage: "pipeline", source: label });
    // REQ-009: bounded flush — mirrors api onFatal; prevents a hung PostHog network call
    // from wedging the crash exit indefinitely.
    await Promise.race([
      shutdownPostHog(),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
    process.exit(1);
  };
}
