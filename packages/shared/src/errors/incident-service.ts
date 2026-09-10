/**
 * IncidentService — the code-driven heart of the error-tracking system
 * (replaces the design's PostHog-webhook relay). Given a raw error captured
 * anywhere in api/pipeline, it:
 *   1. classifies + fingerprints the error,
 *   2. redacts secrets from message/stack,
 *   3. upserts an `error_incidents` row (occurrence dedup),
 *   4. on a NEW (or reopened/escalated) incident, sends the universal Slack ping
 *      and takes the lane-specific action (human/agent → GitHub issue; notify → none).
 *
 * Every new error pings Slack regardless of lane (universal Slack requirement).
 * Repeat occurrences of an open incident are silent bumps. A `notify` incident
 * that recurs to the escalation threshold promotes to `human` and re-pings once.
 *
 * No drizzle import — the repo is injected, so this lives cleanly in shared.
 * `record()` never throws; failures are logged and swallowed.
 */
import { postToWebhook } from "../slack/webhook-client.js";
import { redactSecrets } from "./redact.js";
import { analyzeError } from "./tags.js";
import type { GithubClient } from "../github/client.js";
import type {
  ErrorCategory,
  ErrorIncidentRecord,
  Fixability,
  IncidentContext,
  IncidentStatus,
  SourcePackage,
} from "./types.js";

const STACK_LIMIT = 4000;

/**
 * Categories eligible for the Phase 2 auto-fix dispatch. Schema-only in v1:
 * upstream-shape changes / collector parser-drift land here, are in-repo,
 * localizable from the stack, and verifiable by tests — the cleanest auto-fix
 * target. Widen (e.g. add "code-bug") once merge rate is proven on real traffic.
 */
export const DEFAULT_AUTOFIX_CATEGORIES: readonly ErrorCategory[] = ["schema"];

/** repository_dispatch event_type the error-autofix workflow keys on. */
export const AUTOFIX_EVENT_TYPE = "error-autofix";

export interface UpsertIncidentInput {
  fingerprint: string;
  category: ErrorIncidentRecord["category"];
  fixability: Fixability;
  sourcePackage: SourcePackage;
  context: IncidentContext;
  posthogIssueUrl?: string;
}

export interface UpsertIncidentResult {
  incident: ErrorIncidentRecord;
  /** True for a brand-new fingerprint or a reopened (previously `resolved`) incident. */
  isNew: boolean;
}

/** Persistence contract implemented by the per-package error-incidents repos. */
export interface IncidentRepo {
  upsertByFingerprint(input: UpsertIncidentInput): Promise<UpsertIncidentResult>;
  markStatus(
    fingerprint: string,
    status: IncidentStatus,
    githubRef?: string,
  ): Promise<void>;
}

export interface IncidentServiceLogger {
  warn: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
}

export interface IncidentServiceDeps {
  repo: IncidentRepo;
  /** Master kill-switch. When false, `record()` is a no-op. */
  enabled: boolean;
  slackWebhookUrl?: string;
  github?: GithubClient;
  fetchFn?: typeof fetch;
  logger?: IncidentServiceLogger;
  /** `notify` incident recurring to this count promotes to `human`. Default 3. */
  escalationThreshold?: number;
  /** Base PostHog project URL for issue back-links, if available. */
  posthogIssueBaseUrl?: string;
  /**
   * When true, an agent-fixable incident whose category is in `autofixCategories`
   * fires a `repository_dispatch` to the auto-fix workflow (in addition to the
   * tracked issue). Default false. Requires `github` to be set.
   */
  autofixEnabled?: boolean;
  /** Categories eligible for auto-fix dispatch. Default {@link DEFAULT_AUTOFIX_CATEGORIES}. */
  autofixCategories?: readonly ErrorCategory[];
}

export interface RecordIncidentInput {
  err: unknown;
  sourcePackage: SourcePackage;
  /** Logical source label (queue, collector, route, crash label). */
  source: string;
  runId?: string;
  jobId?: string;
}

export interface IncidentService {
  record(input: RecordIncidentInput): Promise<void>;
}

const LANE_LABEL: Record<Fixability, string> = {
  agent: "🤖 agent-fixable",
  human: "🧑 human-required",
  notify: "🔔 notify-only",
};

function truncate(text: string | undefined, limit: number): string | undefined {
  if (text === undefined) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}\n…(truncated)` : text;
}

function buildSlackBlocks(args: {
  fingerprint: string;
  category: string;
  fixability: Fixability;
  occurrenceCount: number;
  message: string;
  source: string;
  sourcePackage: SourcePackage;
  escalated: boolean;
  posthogIssueUrl?: string;
}): unknown[] {
  const header = args.escalated
    ? `⬆️ Escalated incident — ${LANE_LABEL.human}`
    : `🚨 New incident — ${LANE_LABEL[args.fixability]}`;
  const fields = [
    `*Category:* ${args.category}`,
    `*Source:* ${args.sourcePackage} / ${args.source}`,
    `*Occurrences:* ${String(args.occurrenceCount)}`,
    `*Fingerprint:* \`${args.fingerprint}\``,
  ];
  if (args.posthogIssueUrl !== undefined) {
    fields.push(`*PostHog:* <${args.posthogIssueUrl}|issue>`);
  }
  return [
    { type: "header", text: { type: "plain_text", text: header } },
    { type: "section", fields: fields.map((text) => ({ type: "mrkdwn", text })) },
    {
      type: "section",
      text: { type: "mrkdwn", text: `\`\`\`${args.message.slice(0, 800)}\`\`\`` },
    },
  ];
}

function buildIssueBody(args: {
  fingerprint: string;
  category: string;
  fixability: Fixability;
  sourcePackage: SourcePackage;
  source: string;
  context: IncidentContext;
  posthogIssueUrl?: string;
}): string {
  const lines = [
    `**Fingerprint:** \`${args.fingerprint}\``,
    `**Category:** ${args.category}`,
    `**Lane:** ${LANE_LABEL[args.fixability]}`,
    `**Source:** ${args.sourcePackage} / ${args.source}`,
  ];
  if (args.context.runId !== undefined) lines.push(`**Run:** ${args.context.runId}`);
  if (args.context.jobId !== undefined) lines.push(`**Job:** ${args.context.jobId}`);
  if (args.posthogIssueUrl !== undefined) lines.push(`**PostHog:** ${args.posthogIssueUrl}`);
  lines.push("", "**Message**", "```", args.context.message, "```");
  if (args.context.stack !== undefined) {
    lines.push("", "<details><summary>Stack</summary>", "", "```", args.context.stack, "```", "", "</details>");
  }
  lines.push("", "_Filed automatically by error-tracking. Secrets are redacted._");
  return lines.join("\n");
}

export function createIncidentService(deps: IncidentServiceDeps): IncidentService {
  const threshold = deps.escalationThreshold ?? 3;
  const autofixEnabled = deps.autofixEnabled ?? false;
  const autofixCategories = deps.autofixCategories ?? DEFAULT_AUTOFIX_CATEGORIES;
  const warn = (obj: unknown, msg: string): void => {
    if (deps.logger) deps.logger.warn(obj, msg);
    else console.warn(`[incident] ${msg}`);
  };

  return {
    async record(input: RecordIncidentInput): Promise<void> {
      if (!deps.enabled) return;
      try {
        const analysis = analyzeError(input.err, { source: input.source });
        const rawMessage = input.err instanceof Error ? input.err.message : String(input.err);
        const rawStack = input.err instanceof Error ? input.err.stack : undefined;
        const context: IncidentContext = {
          message: redactSecrets(rawMessage),
          stack: truncate(rawStack === undefined ? undefined : redactSecrets(rawStack), STACK_LIMIT),
          source: input.source,
          runId: input.runId,
          jobId: input.jobId,
        };

        const { incident, isNew } = await deps.repo.upsertByFingerprint({
          fingerprint: analysis.fingerprint,
          category: analysis.category,
          fixability: analysis.fixability,
          sourcePackage: input.sourcePackage,
          context,
        });

        // A notify-lane incident that recurs to the threshold promotes to human,
        // exactly once (occurrenceCount increments by 1, so === fires a single time).
        const escalated =
          !isNew &&
          incident.fixability === "notify" &&
          incident.occurrenceCount === threshold;

        if (!isNew && !escalated) return; // silent dedup bump

        const effectiveFixability: Fixability = escalated ? "human" : incident.fixability;

        // Universal Slack ping — every new/reopened/escalated incident, any lane.
        if (deps.slackWebhookUrl !== undefined && deps.slackWebhookUrl !== "") {
          const result = await postToWebhook({
            url: deps.slackWebhookUrl,
            fetchFn: deps.fetchFn,
            blocks: buildSlackBlocks({
              fingerprint: incident.fingerprint,
              category: incident.category,
              fixability: effectiveFixability,
              occurrenceCount: incident.occurrenceCount,
              message: context.message,
              source: input.source,
              sourcePackage: input.sourcePackage,
              escalated,
            }),
          });
          if (!result.ok) warn({ status: result.status, error: result.error }, "slack ping failed");
        }

        // Lane action: human/agent open a tracked issue; notify does nothing extra.
        // The `githubRef === null` guard means this fires once per fingerprint.
        if (
          (effectiveFixability === "human" || effectiveFixability === "agent") &&
          deps.github !== undefined &&
          incident.githubRef === null
        ) {
          const label = effectiveFixability === "agent" ? "agent-fixable" : "needs-human";
          const issue = await deps.github.createIssue({
            title: `[${incident.category}] ${context.message.slice(0, 120)}`,
            body: buildIssueBody({
              fingerprint: incident.fingerprint,
              category: incident.category,
              fixability: effectiveFixability,
              sourcePackage: input.sourcePackage,
              source: input.source,
              context,
            }),
            labels: ["error-tracking", label],
          });
          if (issue !== null) {
            await deps.repo.markStatus(incident.fingerprint, "open", issue.url);

            // Phase 2 — agent lane additionally fires a repository_dispatch to the
            // auto-fix workflow, which opens a draft PR. Gated by autofixEnabled +
            // category allowlist (schema-only in v1). The tracked issue above gives
            // the draft PR something to `Closes #N`. Fires once (githubRef guard).
            if (
              effectiveFixability === "agent" &&
              autofixEnabled &&
              autofixCategories.includes(incident.category)
            ) {
              const dispatched = await deps.github.dispatch({
                eventType: AUTOFIX_EVENT_TYPE,
                clientPayload: {
                  fingerprint: incident.fingerprint,
                  category: incident.category,
                  sourcePackage: input.sourcePackage,
                  source: input.source,
                  message: context.message,
                  stack: context.stack ?? "",
                  runId: context.runId ?? "",
                  jobId: context.jobId ?? "",
                  issueNumber: issue.number,
                  issueUrl: issue.url,
                },
              });
              if (!dispatched) {
                warn({ fingerprint: incident.fingerprint }, "autofix dispatch failed");
              }
            }
          }
        }
      } catch (err) {
        // Recording an incident must never crash the host process.
        warn({ err: err instanceof Error ? err.message : String(err) }, "record failed");
      }
    },
  };
}
