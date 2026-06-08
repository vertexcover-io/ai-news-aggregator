import type { Logger } from "../logger.js";
import type {
  AlertChannel,
  CaptureIncidentInput,
  Incident,
  IncidentRepository,
  UpsertResult,
} from "../types/incident.js";
import { INCIDENT_ALERT_COOLDOWN_MS } from "../constants/index.js";
import { fingerprintFor } from "./fingerprint.js";

export interface AlertDispatcherDeps {
  repo: IncidentRepository;
  channels: AlertChannel[];
  /** Optional logger; defaults to a no-op if not provided. */
  logger?: Pick<Logger, "fatal"> | undefined;
  /** Injectable clock for testability. */
  clock?: { now: () => Date } | undefined;
}

export interface AlertDispatcher {
  /**
   * Capture an incident: persist it durably, then attempt Slack delivery if
   * appropriate. NEVER throws into the caller (REQ-017 / NF1).
   */
  capture(input: CaptureIncidentInput): Promise<void>;
}

/**
 * Create the alert dispatcher.
 *
 * Orchestration (durable-first, never-throws — REQ-013/017/018):
 * 1. Upsert the incident via `repo.upsertByFingerprint` (persist first).
 * 2. If severity is `info` → return (REQ-012).
 * 3. If status is `muted` → return (REQ-022).
 * 4. If `shouldNotify` is false (cooldown) → return (REQ-010).
 * 5. If no enabled channel → return (REQ-019).
 * 6. Attempt `channel.send`; on success → `markDelivered`; on failure →
 *    `incrementDeliveryAttempts` (REQ-014).
 * Any uncaught error → `logger.fatal` + return (REQ-018, EDGE-003).
 *
 * NOTE: `shouldNotify` is computed by the repo from the PRE-UPDATE `notified_at`
 * (REQ-011). The dispatcher treats it as authoritative and never recomputes.
 */
export function createAlertDispatcher(deps: AlertDispatcherDeps): AlertDispatcher {
  const { repo, channels } = deps;
  const logger = deps.logger;
  const clock = deps.clock ?? { now: () => new Date() };

  return {
    async capture(input: CaptureIncidentInput): Promise<void> {
      try {
        const upsertResult = await repo.upsertByFingerprint(input, INCIDENT_ALERT_COOLDOWN_MS);
        const { id, shouldNotify, status } = upsertResult;

        // REQ-012: info severity never alerts
        if (input.severity === "info") return;

        // REQ-022: muted incidents count occurrences but never alert
        if (status === "muted") return;

        // REQ-010: cooldown / dedup
        if (!shouldNotify) return;

        // REQ-019: no enabled channel → persist-only path
        const enabledChannels = channels.filter((c) => c.enabled);
        if (enabledChannels.length === 0) return;

        // Build a minimal Incident view for the channel (we only have upsert result
        // at this point; the channel implementations can fetch more if needed)
        const incident: Incident = buildIncidentFromInput(input, id, upsertResult);

        // Attempt delivery on the first enabled channel (length > 0 checked above)
        const ok = await enabledChannels[0].send(incident);

        if (ok) {
          // REQ-013: durable-first → persist already done; now mark delivered
          await repo.markDelivered(id, clock.now());
        } else {
          // REQ-014: failed send → leave undelivered, increment attempts
          await repo.incrementDeliveryAttempts(id);
        }
      } catch (err) {
        // REQ-017/018, EDGE-003: never throw; log fatal
        if (logger !== undefined) {
          logger.fatal(
            { event: "alert.capture_failed", err },
            "Failed to capture incident — incident may be lost",
          );
        }
      }
    },
  };
}

/**
 * Build the Incident view passed to a channel for rendering.
 *
 * `occurrences` / `deliveryAttempts` come from the upsert result so a deduped,
 * post-cooldown alert reports the REAL event frequency (not a hardcoded 1).
 * `firstSeenAt` / `lastSeenAt` are approximated to now() for the payload — the
 * channel only needs them for display, and the authoritative timestamps live in
 * the DB row.
 */
function buildIncidentFromInput(
  input: CaptureIncidentInput,
  id: string,
  upsertResult: UpsertResult,
): Incident {
  const now = new Date();
  return {
    id,
    fingerprint: fingerprintFor(input.category, input.source, undefined),
    severity: input.severity,
    category: input.category,
    title: input.title,
    message: input.message,
    source: input.source ?? null,
    runId: input.runId ?? null,
    context: input.context ?? {},
    status: upsertResult.status,
    occurrences: upsertResult.occurrences,
    deliveryAttempts: upsertResult.deliveryAttempts,
    firstSeenAt: now,
    lastSeenAt: now,
    notifiedAt: null,
  };
}
