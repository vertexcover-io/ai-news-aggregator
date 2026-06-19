/**
 * Tenant error alerts (P16, REQ-091): run-crash notifications to the
 * tenant's configured channels. Markerless by design — the D-111 counterpart
 * to D-107: a crashed run has no successful archive flow to carry a
 * notification_state marker, and re-alerting a retried-and-failed job beats
 * silently dropping the alert.
 *
 * Never throws: alerting must not change a run's failure semantics.
 */
import { buildRunCrashMessage, postToWebhook } from "@newsletter/shared";
import type { NotificationEmailSender } from "@pipeline/services/notification-email.js";
import type { TenantNotificationChannels } from "@pipeline/services/tenant-notify.js";

interface AlertLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

export interface RunCrashAlertInput {
  runId: string;
  error: string;
  stage?: string;
}

export interface ErrorAlerter {
  runCrashed(input: RunCrashAlertInput): Promise<void>;
}

export function createErrorAlerter(deps: {
  channels: TenantNotificationChannels;
  emailSender?: NotificationEmailSender;
  postToWebhookFn?: typeof postToWebhook;
  logger: AlertLogger;
}): ErrorAlerter {
  const post = deps.postToWebhookFn ?? postToWebhook;
  return {
    async runCrashed(input: RunCrashAlertInput): Promise<void> {
      if (!deps.channels.notifyErrors) return;

      const { slackWebhookUrl, notifyEmail } = deps.channels;

      if (slackWebhookUrl !== undefined) {
        try {
          const { blocks } = buildRunCrashMessage(input);
          const result = await post({ url: slackWebhookUrl, blocks });
          if (!result.ok) {
            deps.logger.warn(
              { event: "error_alert.slack_failed", runId: input.runId, status: result.status },
              "run-crash slack alert failed",
            );
          }
        } catch (err) {
          deps.logger.warn(
            {
              event: "error_alert.slack_failed",
              runId: input.runId,
              error: err instanceof Error ? err.message : String(err),
            },
            "run-crash slack alert threw",
          );
        }
      }

      if (notifyEmail !== undefined && deps.emailSender !== undefined) {
        try {
          await deps.emailSender.send({
            to: notifyEmail,
            subject: "Your daily run failed",
            text: [
              `Run ${input.runId} failed${input.stage !== undefined ? ` during ${input.stage}` : ""}.`,
              `Error: ${input.error}`,
            ].join("\n"),
          });
        } catch (err) {
          deps.logger.warn(
            {
              event: "error_alert.email_failed",
              runId: input.runId,
              error: err instanceof Error ? err.message : String(err),
            },
            "run-crash email alert failed",
          );
        }
      }
    },
  };
}
