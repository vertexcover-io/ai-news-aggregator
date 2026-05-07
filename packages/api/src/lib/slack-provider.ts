import {
  createSlackNotifier,
  createLogger,
  type SlackNotifier,
  type NotifierArchiveAccess,
  type NotifierSubscriberCount,
  type NotifierTopRankedTitle,
} from "@newsletter/shared";

export interface CreateApiSlackNotifierDeps {
  archives: NotifierArchiveAccess;
  subscribers: NotifierSubscriberCount;
  resolveTopRankedTitle: NotifierTopRankedTitle;
}

export function createApiSlackNotifier(
  deps: CreateApiSlackNotifierDeps,
): SlackNotifier {
  return createSlackNotifier({
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    archives: deps.archives,
    subscribers: deps.subscribers,
    resolveTopRankedTitle: deps.resolveTopRankedTitle,
    logger: createLogger("api:slack"),
    publicArchiveBaseUrl: process.env.PUBLIC_BASE_URL,
  });
}
