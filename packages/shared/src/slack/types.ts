import type { Logger } from "pino";
import type { NotificationKey, NotificationState } from "../types/notifications.js";
import type { RunSourceTelemetry } from "../types/run.js";
import type { PublishChannel } from "../scheduling/job-ids.js";
import type { PublishUnavailableReason } from "./builders/publish-unavailable.js";

export interface SlackNotifier {
  /**
   * @deprecated Use notifySourceDistribution, notifyEmailDelivery,
   * notifyLinkedinPosted, and notifyTwitterPosted instead.
   */
  notifyNewsletterSent(input: NotifyNewsletterSentInput): Promise<void>;
  notifyReviewPending(input: { runId: string }): Promise<void>;
  notifyReviewWarning(input: {
    runId: string;
    earliestChannel: PublishChannel;
    earliestTime: string;
    minutesUntil: number;
  }): Promise<void>;
  notifyPublishFailed(input: {
    runId: string;
    channel: PublishChannel;
  }): Promise<void>;
  notifyPublishUnavailable?(input: {
    channel: PublishChannel;
    reason: PublishUnavailableReason;
    runId?: string;
  }): Promise<void>;
  notifySourceDistribution(input: SourceDistributionInput): Promise<void>;
  notifyEmailDelivery(input: EmailDeliveryInput): Promise<void>;
  notifyLinkedinPosted(input: LinkedinPostedInput): Promise<void>;
  notifyTwitterPosted(input: TwitterPostedInput): Promise<void>;
}

export interface DeliveryFailureReason {
  reason: string;
  count: number;
}

export interface DeliveryCounts {
  attempted: number;
  sent: number;
  failed: number;
  /** Aggregated failure reasons, in descending count order. Empty when all sent. */
  failureReasons?: DeliveryFailureReason[];
}

export interface SocialPostReport {
  status: "posted" | "skipped" | "failed";
  reason?: string;
  permalink?: string | null;
}

export interface SocialResultsForSlack {
  linkedin?: SocialPostReport;
  twitter?: SocialPostReport;
}

export interface SourceDistributionInput {
  runId: string;
}

export interface EmailDeliveryInput {
  runId: string;
  delivery: DeliveryCounts;
}

export interface LinkedinPostedInput {
  runId: string;
  permalink: string;
}

export interface TwitterPostedInput {
  runId: string;
  permalink: string;
}

export interface NotifyNewsletterSentInput {
  runId: string;
  delivery: DeliveryCounts;
  socialResults?: SocialResultsForSlack;
}

export interface NotifierArchiveView {
  id: string;
  digestHeadline: string | null;
  rankedItems: { rawItemId: number }[];
  sourceTelemetry: RunSourceTelemetry | null;
  slackNotifiedAt: Date | null;
  notificationState: NotificationState | null;
  isDryRun: boolean;
}

export interface NotifierArchiveAccess {
  findById(runId: string): Promise<NotifierArchiveView | null>;
  markSlackNotified(runId: string, at: Date): Promise<void>;
  markNotification(runId: string, key: NotificationKey, at: Date): Promise<void>;
}

export type NotifierTopRankedTitle = (
  archive: NotifierArchiveView,
) => Promise<string | null>;

export interface SlackNotifierDeps {
  webhookUrl: string | undefined;
  archives: NotifierArchiveAccess;
  resolveTopRankedTitle: NotifierTopRankedTitle;
  logger: Logger;
  fetchFn?: typeof fetch;
  now?: () => Date;
  publicArchiveBaseUrl?: string;
}
