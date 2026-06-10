import { buildReviewedMessage } from "./message-builder.js";
import { buildPublishFailedMessage } from "./builders/publish-failed.js";
import { buildPublishUnavailableMessage } from "./builders/publish-unavailable.js";
import { buildReviewPendingMessage } from "./builders/review-pending.js";
import { buildReviewWarningMessage } from "./builders/review-warning.js";
import { buildSourceDistributionMessage } from "./builders/source-distribution.js";
import { buildEmailDeliveryMessage } from "./builders/email-delivery.js";
import { buildLinkedinPostedMessage } from "./builders/linkedin-posted.js";
import { buildTwitterPostedMessage } from "./builders/twitter-posted.js";
import { buildSubscriberConfirmedMessage } from "./builders/subscriber-confirmed.js";
import { buildSubscriberRemovedMessage } from "./builders/subscriber-removed.js";
import { buildFeedbackReceivedMessage } from "./builders/feedback-received.js";
import type { FeedbackRating } from "../db/schema.js";
import type {
  NotifyNewsletterSentInput,
  SlackNotifier,
  SlackNotifierDeps,
  SourceDistributionInput,
  EmailDeliveryInput,
  LinkedinPostedInput,
  TwitterPostedInput,
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

  // Resolve the effective webhook URL: per-tenant config overrides global.
  const tenantWebhook = deps.tenantNotificationConfig?.slackWebhook ?? null;
  const effectiveWebhook = tenantWebhook ?? webhookUrl;

  if (effectiveWebhook === undefined || effectiveWebhook === "") {
    logger.info(
      { event: "slack.notify.disabled" },
      "slack notifications disabled (no webhook URL configured)",
    );
    return {
      notifyNewsletterSent: (): Promise<void> => Promise.resolve(),
      notifyReviewPending: (): Promise<void> => Promise.resolve(),
      notifyReviewWarning: (): Promise<void> => Promise.resolve(),
      notifyPublishFailed: (): Promise<void> => Promise.resolve(),
      notifyPublishUnavailable: (): Promise<void> => Promise.resolve(),
      notifySourceDistribution: (): Promise<void> => Promise.resolve(),
      notifyEmailDelivery: (): Promise<void> => Promise.resolve(),
      notifyLinkedinPosted: (): Promise<void> => Promise.resolve(),
      notifyTwitterPosted: (): Promise<void> => Promise.resolve(),
      notifySubscriberConfirmed: (): Promise<void> => Promise.resolve(),
      notifySubscriberRemoved: (): Promise<void> => Promise.resolve(),
      notifyFeedbackReceived: (): Promise<void> => Promise.resolve(),
    };
  }

  if (!effectiveWebhook.startsWith(SLACK_WEBHOOK_PREFIX)) {
    logger.warn(
      {
        event: "slack.notify.suspicious_url",
        host: parseHost(effectiveWebhook),
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
        url: effectiveWebhook,
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
          url: effectiveWebhook,
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
      reason?: string;
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
            reason: input.reason,
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
          url: effectiveWebhook,
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

    async notifySourceDistribution(input: SourceDistributionInput): Promise<void> {
      try {
        const archive = await deps.archives.findById(input.runId);
        if (archive === null) {
          logger.warn(
            { event: "slack.source_distribution.archive_missing", runId: input.runId },
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
        if (archive.notificationState?.sourceDistribution !== undefined) {
          logger.info(
            { event: "slack.source_distribution.skipped", reason: "already_notified", runId: input.runId },
            "slack notification skipped (already notified)",
          );
          return;
        }
        if (archive.sourceTelemetry === null) {
          logger.info(
            { event: "slack.source_distribution.skipped", reason: "no_telemetry", runId: input.runId },
            "slack source distribution skipped (no telemetry)",
          );
          return;
        }
        const blocks = buildSourceDistributionMessage({
          runId: input.runId,
          headline: archive.digestHeadline,
          sourceTelemetry: archive.sourceTelemetry,
          publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
        }).blocks;
        const result = await postToWebhook({ url: effectiveWebhook, blocks, fetchFn: deps.fetchFn });
        if (!result.ok) {
          logger.warn(
            { event: "slack.source_distribution.failed", runId: input.runId, status: result.status, responseBody: result.error },
            "slack notification failed",
          );
          return;
        }
        const now = (deps.now ?? ((): Date => new Date()))();
        await deps.archives.markNotification(input.runId, "sourceDistribution", now);
        logger.info({ event: "slack.source_distribution.sent", runId: input.runId }, "slack notification sent");
      } catch (err) {
        logger.warn(
          { event: "slack.source_distribution.failed", runId: input.runId, error: err instanceof Error ? err.message : String(err) },
          "slack notification threw unexpectedly",
        );
      }
    },

    notifyEmailDelivery(input: EmailDeliveryInput): Promise<void> {
      return notifyWithMarker({
        runId: input.runId,
        key: "emailDelivery",
        event: "slack.email_delivery",
        blocks: (archive) =>
          buildEmailDeliveryMessage({
            runId: input.runId,
            headline: archive?.digestHeadline ?? null,
            delivery: input.delivery,
            publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
          }).blocks,
      });
    },

    notifyLinkedinPosted(input: LinkedinPostedInput): Promise<void> {
      return notifyWithMarker({
        runId: input.runId,
        key: "linkedinPosted",
        event: "slack.linkedin_posted",
        blocks: (archive) =>
          buildLinkedinPostedMessage({
            runId: input.runId,
            headline: archive?.digestHeadline ?? null,
            permalink: input.permalink,
            publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
          }).blocks,
      });
    },

    notifyTwitterPosted(input: TwitterPostedInput): Promise<void> {
      return notifyWithMarker({
        runId: input.runId,
        key: "twitterPosted",
        event: "slack.twitter_posted",
        blocks: (archive) =>
          buildTwitterPostedMessage({
            runId: input.runId,
            headline: archive?.digestHeadline ?? null,
            permalink: input.permalink,
            publicArchiveBaseUrl: deps.publicArchiveBaseUrl,
          }).blocks,
      });
    },

    async notifySubscriberConfirmed(input: {
      readonly email: string;
      readonly totalConfirmed: number;
    }): Promise<void> {
      try {
        const { blocks } = buildSubscriberConfirmedMessage(input);
        const result = await postToWebhook({ url: effectiveWebhook, blocks, fetchFn: deps.fetchFn });
        if (!result.ok) {
          logger.warn(
            {
              event: "slack.subscriber_confirmed.failed",
              status: result.status,
              responseBody: result.error,
            },
            "slack subscriber confirmed notification failed",
          );
        }
      } catch (err) {
        logger.warn(
          {
            event: "slack.subscriber_confirmed.failed",
            error: err instanceof Error ? err.message : String(err),
          },
          "slack subscriber confirmed notification threw unexpectedly",
        );
      }
    },

    async notifySubscriberRemoved(input: {
      readonly email: string;
      readonly via: "unsubscribe-link" | "one-click" | "bounce" | "complaint";
      readonly totalConfirmed: number;
    }): Promise<void> {
      try {
        const { blocks } = buildSubscriberRemovedMessage(input);
        const result = await postToWebhook({ url: effectiveWebhook, blocks, fetchFn: deps.fetchFn });
        if (!result.ok) {
          logger.warn(
            {
              event: "slack.subscriber_removed.failed",
              status: result.status,
              responseBody: result.error,
            },
            "slack subscriber removed notification failed",
          );
        }
      } catch (err) {
        logger.warn(
          {
            event: "slack.subscriber_removed.failed",
            error: err instanceof Error ? err.message : String(err),
          },
          "slack subscriber removed notification threw unexpectedly",
        );
      }
    },

    async notifyFeedbackReceived(input: {
      readonly email: string;
      readonly rating: FeedbackRating;
    }): Promise<void> {
      try {
        const { blocks } = buildFeedbackReceivedMessage(input);
        const result = await postToWebhook({ url: effectiveWebhook, blocks, fetchFn: deps.fetchFn });
        if (!result.ok) {
          logger.warn(
            {
              event: "slack.feedback_received.failed",
              status: result.status,
              responseBody: result.error,
            },
            "slack feedback received notification failed",
          );
        }
      } catch (err) {
        logger.warn(
          {
            event: "slack.feedback_received.failed",
            error: err instanceof Error ? err.message : String(err),
          },
          "slack feedback received notification threw unexpectedly",
        );
      }
    },
  };
}
