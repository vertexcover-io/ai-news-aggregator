import type { Logger } from "pino";
import type { RunSourceTelemetry } from "../types/run.js";

export interface SlackNotifier {
  notifyNewsletterSent(input: NotifyNewsletterSentInput): Promise<void>;
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

export interface NotifyNewsletterSentInput {
  runId: string;
  delivery: DeliveryCounts;
}

export interface NotifierArchiveView {
  id: string;
  digestHeadline: string | null;
  rankedItems: { rawItemId: number }[];
  sourceTelemetry: RunSourceTelemetry | null;
  slackNotifiedAt: Date | null;
}

export interface NotifierArchiveAccess {
  findById(runId: string): Promise<NotifierArchiveView | null>;
  markSlackNotified(runId: string, at: Date): Promise<void>;
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
