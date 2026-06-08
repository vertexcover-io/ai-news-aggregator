/**
 * @newsletter/shared/alerting
 *
 * Web-safe subpath export for the alert dispatcher, fingerprinting, and
 * run-health evaluator.
 *
 * IMPORTANT (REQ-026 / D-100 / D-102):
 * This module does NOT import drizzle-orm or @newsletter/shared/db.
 * It depends only on the injected IncidentRepository interface (types/incident.ts).
 * The actual SQL upsert lives in api/pipeline repos (Phases 2 & 3).
 */

export { createAlertDispatcher } from "./dispatcher.js";
export type { AlertDispatcher, AlertDispatcherDeps } from "./dispatcher.js";

export { fingerprintFor } from "./fingerprint.js";

export { evaluateRunHealth } from "./run-health.js";
export type { RunHealthInput, EnrichmentTelemetry, SourceTelemetryEntry, PublishResult } from "./run-health.js";

export { createSlackAlertChannel } from "../slack/alert-channel.js";
export type { SlackAlertChannelDeps } from "../slack/alert-channel.js";

export { buildIncidentMessage } from "../slack/builders/incident.js";

export type {
  IncidentSeverity,
  IncidentCategory,
  IncidentStatus,
  Incident,
  IncidentContext,
  CaptureIncidentInput,
  IncidentRepository,
  IncidentListFilter,
  AlertChannel,
  UpsertResult,
} from "../types/incident.js";
