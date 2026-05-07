import type { Logger } from "pino";
import type { RunSourceTelemetry } from "../types/run.js";

export interface SlackNotifier {
  notifyReviewedArchive(input: NotifyReviewedInput): Promise<void>;
}

export interface NotifyReviewedInput {
  runId: string;
  trigger: "manual" | "auto-review";
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

export interface NotifierSubscriberCount {
  countConfirmed(): Promise<number>;
}

export type NotifierTopRankedTitle = (
  archive: NotifierArchiveView,
) => Promise<string | null>;

export interface SlackNotifierDeps {
  webhookUrl: string | undefined;
  archives: NotifierArchiveAccess;
  subscribers: NotifierSubscriberCount;
  resolveTopRankedTitle: NotifierTopRankedTitle;
  logger: Logger;
  fetchFn?: typeof fetch;
  now?: () => Date;
  publicArchiveBaseUrl?: string;
}
