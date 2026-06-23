/**
 * Review-ready notification fan-out (P16, REQ-090): when a run completes and
 * needs human review, alert the tenant on its configured channels —
 * Slack (via the per-tenant notifier, D-107 `reviewPending` marker) and/or
 * email (D-107 `reviewPendingEmail` marker on the same
 * run_archives.notification_state JSONB).
 *
 * D-107 contract on the email channel mirrors notifyWithMarker: dry-run and
 * already-marked archives short-circuit; a FAILED send writes no marker so a
 * retried job re-sends (duplicate beats missed).
 */
import type { SlackNotifier } from "@newsletter/shared";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { NotificationEmailSender } from "@pipeline/services/notification-email.js";
import type { TenantNotificationChannels } from "@pipeline/services/tenant-notify.js";

interface NotifyLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

export interface NotifyReviewReadyInput {
  runId: string;
  /**
   * Resolved per-tenant channels; undefined = legacy wiring (no tenant
   * resolution) → Slack-only via whatever webhook the notifier was built
   * with, toggles treated as on.
   */
  channels?: TenantNotificationChannels;
  /** Built with the tenant-resolved webhook (or the global fallback). */
  slackNotifier: SlackNotifier | undefined;
  emailSender?: NotificationEmailSender;
  archives: Pick<RunArchivesRepo, "findById" | "markNotification">;
  logger: NotifyLogger;
  publicArchiveBaseUrl?: string;
  now?: () => Date;
}

export async function notifyReviewReady(input: NotifyReviewReadyInput): Promise<void> {
  const { runId, channels, logger } = input;

  if (channels?.notifyReviewReady === false) {
    logger.info(
      { event: "review_ready.skipped", reason: "toggle_off", runId },
      "review-ready notification skipped (tenant toggle off)",
    );
    return;
  }

  // Slack channel — idempotency (reviewPending marker) lives in the notifier.
  await input.slackNotifier?.notifyReviewPending({ runId });

  // Email channel.
  const to = channels?.notifyEmail;
  if (to === undefined || input.emailSender === undefined) return;

  try {
    const archive = await input.archives.findById(runId);
    if (archive === null) {
      logger.warn(
        { event: "review_ready.email.archive_missing", runId },
        "archive not found for review-ready email",
      );
      return;
    }
    if (archive.isDryRun) return;
    if (archive.notificationState?.reviewPendingEmail !== undefined) {
      logger.info(
        { event: "review_ready.email.skipped", reason: "already_notified", runId },
        "review-ready email skipped (already notified)",
      );
      return;
    }

    const base = input.publicArchiveBaseUrl;
    const reviewUrl = base !== undefined ? `${base}/admin/review/${runId}` : undefined;
    await input.emailSender.send({
      to,
      subject: "Your daily run is ready to review",
      text: [
        archive.digestHeadline !== null
          ? `"${archive.digestHeadline}" is ready to curate.`
          : "Today's run is ready to curate.",
        ...(reviewUrl !== undefined ? [`Review it here: ${reviewUrl}`] : []),
        `Run: ${runId}`,
      ].join("\n"),
    });

    const now = (input.now ?? ((): Date => new Date()))();
    await input.archives.markNotification(runId, "reviewPendingEmail", now);
    logger.info(
      { event: "review_ready.email.sent", runId, to },
      "review-ready email sent",
    );
  } catch (err) {
    // No marker on failure — a retried job re-sends (D-107 semantics).
    logger.warn(
      {
        event: "review_ready.email.failed",
        runId,
        error: err instanceof Error ? err.message : String(err),
      },
      "review-ready email failed",
    );
  }
}
