import { postToWebhook } from "@newsletter/shared";
import { createLogger, type Logger } from "@newsletter/shared/logger";

import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";

const logger = createLogger("worker:social-health");
const FAILURE_BODY_MAX = 500;

export interface SocialHealthJobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

export interface SocialHealthDeps {
  twitterApiClient: TwitterApiClient | null;
  logger?: Logger;
  slackWebhookUrl?: string;
  fetchFn?: typeof fetch;
}

function truncate(value: string): string {
  if (value.length <= FAILURE_BODY_MAX) return value;
  return `${value.slice(0, FAILURE_BODY_MAX)}…`;
}

function buildSlackBlocks(status: number, body: string): unknown[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🔴 X credential health check failed",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `X auto-post credentials failed validation before the daily run.\nStatus: ${status}\nResponse: ${truncate(body)}`,
      },
    },
  ];
}

export async function handleSocialHealthJob(
  deps: SocialHealthDeps,
  job: SocialHealthJobLike,
): Promise<void> {
  if (job.name !== "social-health") return;

  const log = deps.logger ?? logger;
  if (deps.twitterApiClient === null) {
    log.warn(
      {
        event: "social.twitter.health_skipped",
        reason: "not_configured",
        jobId: job.id,
      },
      "twitter credential health check skipped",
    );
    return;
  }

  const result = await deps.twitterApiClient.validateCredentials();
  if (result.ok) {
    log.info(
      { event: "social.twitter.health_ok", jobId: job.id },
      "twitter credential health check passed",
    );
    return;
  }

  log.error(
    {
      event: "social.twitter.health_failed",
      jobId: job.id,
      status: result.status,
    },
    "twitter credential health check failed",
  );

  if (deps.slackWebhookUrl === undefined || deps.slackWebhookUrl === "") {
    return;
  }

  const slackResult = await postToWebhook({
    url: deps.slackWebhookUrl,
    blocks: buildSlackBlocks(result.status, result.body),
    fetchFn: deps.fetchFn,
  });
  if (!slackResult.ok) {
    log.error(
      {
        event: "social.twitter.health_slack_failed",
        jobId: job.id,
        status: slackResult.status,
      },
      "twitter credential health slack alert failed",
    );
  }
}
