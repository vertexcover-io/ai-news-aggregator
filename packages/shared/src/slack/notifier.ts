import { buildReviewedMessage } from "./message-builder.js";
import { buildPublishFailedMessage } from "./builders/publish-failed.js";
import { buildPublishUnavailableMessage } from "./builders/publish-unavailable.js";
import { buildReviewPendingMessage } from "./builders/review-pending.js";
import { buildReviewWarningMessage } from "./builders/review-warning.js";
import type {
  NotifyNewsletterSentInput,
  SlackNotifier,
  SlackNotifierDeps,
} from "./types.js";
import type { NotificationKey } from "../types/notifications.js";
import { postToWebhook } from "./webhook-client.js";

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";

function parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

export function createSlackNotifier(deps: SlackNotifierDeps): SlackNotifier {
  const { webhookUrl, logger } = deps;

  if (webhookUrl === undefined || webhookUrl === "") {
    logger.info(
      { event: "slack.notify.disabled" },
      "slack notifications disabled (SLACK_WEBHOOK_URL unset)",
    );
    return {
      notifyNewsletterSent: (): Promise<void> => Promise.resolve(),
      notifyReviewPending: (): Promise<void> => Promise.resolve(),
      notifyReviewWarning: (): Promise<void> => Promise.resolve(),
      notifyPublishFailed: (): Promise<void> => Promise.resolve(),
      notifyPublishUnavailable: (): Promise<void> => Promise.resolve(),
    };
  }

  if (!webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
    logger.warn(
      {
        event: "slack.notify.suspicious_url",
        host: parseHost(webhookUrl),
      },
      "slack webhook URL does not match expected hooks.slack.com prefix",
    );
  }

  const notifyWithMarker = async (input: {
    readonly runId: string;
    readonly key: NotificationKey;
    readonly event: string;
    readonly blocks: (archive: Awaited<ReturnType<typeof deps.archives.findById>>) => unknown[];
  }): Promise<void> => {
    try {
      const archive = await deps.archives.findById(input.runId);
      if (archive === null) {
        logger.warn(
          { event: `${input.event}.archive_missing`, runId: input.runId },
          "archive not found for slack notification",
        );
        return;
      }
      if (archive.isDryRun) {
        logger.info(
          { event: "publish.skipped_dry_run", runId: input.runId, channel: "slack" },
          "slack notification skipped (dry-run archive)",
        );
        return;
      }
      if (archive.notificationState?.[input.key] !== undefined) {
        logger.info(
          { event: `${input.event}.skipped`, reason: "already_notified", runId: input.runId },
          "slack notification skipped (already notified)",
        );
        return;
      }
      const result = await postToWebhook({
        url: webhookUrl,
        blocks: input.blocks(archive),
        fetchFn: deps.fetchFn,
      });
      if (!result.ok) {
        logger.warn(
          {
            event: `${input.event}.failed`,
            runId: input.runId,
            status: result.status,
            responseBody: result.error,
          },
          "slack notification failed",
        );
        return;
      }
      const now = (deps.now ?? ((): Date => new Date()))();
      await deps.archives.markNotification(input.runId, input.key, now);
      logger.info({ event: `${input.event}.sent`, runId: input.runId }, "slack notification sent");
    } catch (err) {
      logger.warn(
        {
          event: `${input.event}.failed`,
          runId: input.runId,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack notification threw unexpectedly",
      );
    }
  };

  return {
    async notifyNewsletterSent(input: NotifyNewsletterSentInput): Promise<void> {
      try {
        const archive = await deps.archives.findById(input.runId);
        if (archive === null) {
          logger.warn(
            {
              event: "slack.notify.archive_missing",
              runId: input.runId,
            },
            "archive not found for slack notification",
          );
          return;
        }

        if (archive.isDryRun) {
          logger.info(
            { event: "publish.skipped_dry_run", runId: input.runId, channel: "slack" },
            "slack notification skipped (dry-run archive)",
          );
          return;
        }

        if (archive.slackNotifiedAt !== null) {
          logger.info(
            {
              event: "slack.notify.skipped",
              reason: "already_notified",
              runId: input.runId,
            },
            "slack notification skipped (already notified)",
          );
          return;
        }

        const topRankedTitle = await deps.resolveTopRankedTitle(archive);

        const { blocks } = buildReviewedMessage({
          runId: input.runId,
          archive: {
            id: archive.id,
            digestHeadline: archive.digestHeadline,
            rankedItems: archive.rankedItems,
          },
          topRankedTitle,
          sourceTelemetry: archive.sourceTelemetry,
          delivery: input.delivery,
          publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
          socialResults: input.socialResults,
        });

        const result = await postToWebhook({
          url: webhookUrl,
          blocks,
          fetchFn: deps.fetchFn,
        });

        if (result.ok) {
          const now = (deps.now ?? ((): Date => new Date()))();
          await deps.archives.markSlackNotified(input.runId, now);
          logger.info(
            {
              event: "slack.notify.sent",
              runId: input.runId,
              attempted: input.delivery.attempted,
              sent: input.delivery.sent,
              failed: input.delivery.failed,
            },
            "slack notification sent",
          );
          return;
        }

        logger.error(
          {
            event: "slack.notify.failed",
            runId: input.runId,
            status: result.status,
            responseBody: result.error,
            host: "hooks.slack.com",
          },
          "slack notification failed",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          {
            event: "slack.notify.failed",
            runId: input.runId,
            error: message,
            host: "hooks.slack.com",
          },
          "slack notification threw unexpectedly",
        );
      }
    },
    notifyReviewPending(input: { runId: string }): Promise<void> {
      return notifyWithMarker({
        runId: input.runId,
        key: "reviewPending",
        event: "slack.review_pending",
        blocks: (archive) =>
          buildReviewPendingMessage({
            runId: input.runId,
            digestHeadline: archive?.digestHeadline ?? null,
            publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
            sourceTelemetry: archive?.sourceTelemetry ?? null,
          }).blocks as unknown[],
      });
    },
    notifyReviewWarning(input: {
      runId: string;
      earliestChannel: "email-send" | "linkedin-post" | "twitter-post";
      earliestTime: string;
      minutesUntil: number;
    }): Promise<void> {
      return notifyWithMarker({
        runId: input.runId,
        key: "reviewWarning",
        event: "slack.review_warning",
        blocks: () =>
          buildReviewWarningMessage({
            runId: input.runId,
            earliestChannel: input.earliestChannel,
            earliestTime: input.earliestTime,
            minutesUntil: input.minutesUntil,
            publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
          }).blocks as unknown[],
      });
    },
    notifyPublishFailed(input: {
      runId: string;
      channel: "email-send" | "linkedin-post" | "twitter-post";
    }): Promise<void> {
      const keyByChannel = {
        "email-send": "emailFailure",
        "linkedin-post": "linkedinFailure",
        "twitter-post": "twitterFailure",
      } as const;
      return notifyWithMarker({
        runId: input.runId,
        key: keyByChannel[input.channel],
        event: "slack.publish_failed",
        blocks: () =>
          buildPublishFailedMessage({
            runId: input.runId,
            channel: input.channel,
            publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
          }).blocks as unknown[],
      });
    },
    async notifyPublishUnavailable(input: {
      channel: "email-send" | "linkedin-post" | "twitter-post";
      reason: "no_archive" | "latest_failed" | "latest_cancelled" | "latest_unreviewed";
      runId?: string;
    }): Promise<void> {
      const keyByChannel = {
        "email-send": "emailFailure",
        "linkedin-post": "linkedinFailure",
        "twitter-post": "twitterFailure",
      } as const;
      const blocks = buildPublishUnavailableMessage({
        channel: input.channel,
        reason: input.reason,
        runId: input.runId,
        publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
      }).blocks as unknown[];

      if (input.runId === undefined) {
        const result = await postToWebhook({
          url: webhookUrl,
          blocks,
          fetchFn: deps.fetchFn,
        });
        if (!result.ok) {
          logger.warn(
            {
              event: "slack.publish_unavailable.failed",
              reason: input.reason,
              channel: input.channel,
              status: result.status,
              responseBody: result.error,
            },
            "slack notification failed",
          );
        }
        return;
      }

      return notifyWithMarker({
        runId: input.runId,
        key: keyByChannel[input.channel],
        event: "slack.publish_unavailable",
        blocks: () => blocks,
      });
    },
  };
}
