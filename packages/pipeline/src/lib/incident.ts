/**
 * Pipeline-side adapter for the shared IncidentService. Lazy process-level
 * singleton (mirrors lib/posthog.ts): built once from env + a DB-backed
 * error_incidents repo, the Slack webhook, and an optional GitHub client.
 *
 * `recordIncident` is the one-liner called right after `captureException` at
 * every pipeline capture site. It is fire-and-forget and never throws — incident
 * recording must not be able to crash a worker or wedge a crash handler.
 *
 * Gated by `ERROR_TRACKING_ENABLED` (default off). When disabled, a no-op.
 */
import { getDb } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import {
  createIncidentService,
  type IncidentService,
  type RecordIncidentInput,
} from "@newsletter/shared/errors";
import { createGithubClient } from "@newsletter/shared/github";
import { createErrorIncidentsRepo } from "@pipeline/repositories/error-incidents.js";

const logger = createLogger("pipeline:incident");
const incidentLogger = {
  warn: (obj: unknown, msg?: string): void => {
    logger.warn(obj as Record<string, unknown>, msg);
  },
};

let service: IncidentService | null = null;
let initialized = false;

function isEnabled(): boolean {
  const v = process.env.ERROR_TRACKING_ENABLED;
  return v === "1" || v === "true";
}

function escalationThreshold(): number {
  const n = Number(process.env.ERROR_ESCALATION_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function getService(): IncidentService | null {
  if (initialized) return service;
  initialized = true;
  if (!isEnabled()) {
    service = null;
    return service;
  }
  const token = process.env.GITHUB_TOKEN;
  const repoSlug = process.env.GITHUB_REPO;
  const github =
    token !== undefined && token !== "" && repoSlug !== undefined && repoSlug !== ""
      ? createGithubClient({ token, repo: repoSlug, logger: incidentLogger })
      : undefined;
  service = createIncidentService({
    repo: createErrorIncidentsRepo(getDb()),
    enabled: true,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    github,
    logger: incidentLogger,
    escalationThreshold: escalationThreshold(),
  });
  return service;
}

/** Record an incident for a captured error. Fire-and-forget; never throws. */
export function recordIncident(input: RecordIncidentInput): void {
  try {
    const s = getService();
    if (s === null) return;
    void s.record(input).catch(() => {
      /* logged inside the service */
    });
  } catch {
    /* never throw from a capture path */
  }
}

export function resetIncidentServiceForTest(): void {
  service = null;
  initialized = false;
}
