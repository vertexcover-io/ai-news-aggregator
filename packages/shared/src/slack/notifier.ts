import { buildReviewedMessage } from "./message-builder.js";
import type {
  NotifyNewsletterSentInput,
  SlackNotifier,
  SlackNotifierDeps,
} from "./types.js";
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
  };
}
