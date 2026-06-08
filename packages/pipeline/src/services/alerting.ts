/**
 * Pipeline-side alert dispatcher factory.
 *
 * Assembles createAlertDispatcher (from @newsletter/shared/alerting) with:
 *   - the pipeline IncidentRepository (DB-backed)
 *   - a Slack alert channel (disabled when SLACK_WEBHOOK_URL is not set)
 *   - the pipeline logger
 *
 * REQ-019: When SLACK_WEBHOOK_URL is unset, the channel is disabled →
 *   incidents persist but no Slack send is attempted.
 * REQ-026: The dispatcher depends on the IncidentRepository interface only
 *   (no drizzle imports here).
 */
import { getDb } from "@newsletter/shared";
import { createAlertDispatcher, createSlackAlertChannel } from "@newsletter/shared/alerting";
import type { AlertDispatcher } from "@newsletter/shared/alerting";
import { createLogger } from "@newsletter/shared/logger";
import { createIncidentRepo } from "@pipeline/repositories/incidents.js";

export function createPipelineAlertDispatcher(): AlertDispatcher {
  const db = getDb();
  const repo = createIncidentRepo(db);
  const logger = createLogger("pipeline:alerting");

  const channel = createSlackAlertChannel({
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  });

  return createAlertDispatcher({ repo, channels: [channel], logger });
}
