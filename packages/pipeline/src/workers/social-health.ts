import { postToWebhook } from "@newsletter/shared";
import { createLogger, type Logger } from "@newsletter/shared/logger";

import { jobTenantId } from "@pipeline/lib/job-tenant.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";
import {
  checkTenantSocialHealth,
  type SocialHealthIssue,
} from "@pipeline/services/social-health.js";
import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";

const logger = createLogger("worker:social-health");

export interface SocialHealthJobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

export interface SocialHealthDeps {
  /** Twitter posting client the tenant's publish jobs would use, or null. */
  getTwitterClient: (tenantId: string) => Promise<TwitterApiClient | null>;
  getTokensRepo: (tenantId: string) => Pick<SocialTokensRepo, "getToken">;
  slackWebhookUrl?: string;
  logger?: Logger;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

function describeIssue(issue: SocialHealthIssue): string {
  const status = issue.status !== undefined ? ` (status ${issue.status})` : "";
  const detail = issue.detail !== undefined ? `\nResponse: ${issue.detail}` : "";
  return `• *${issue.platform}*: ${issue.reason}${status}${detail}`;
}

function buildSlackBlocks(
  tenantId: string,
  issues: SocialHealthIssue[],
): unknown[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🔴 Social credential health check failed",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Social posting credentials failed validation before the daily run.\nTenant: ${tenantId}\n${issues.map(describeIssue).join("\n")}`,
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
  const tenantId = jobTenantId(job.data);

  const twitterClient = await deps.getTwitterClient(tenantId);
  const { checkedPlatforms, issues } = await checkTenantSocialHealth({
    tokens: deps.getTokensRepo(tenantId),
    twitterClient,
    now: deps.now,
  });

  if (checkedPlatforms.length === 0) {
    log.info(
      {
        event: "social.health_noop",
        reason: "nothing_connected",
        tenantId,
        jobId: job.id,
      },
      "social credential health check skipped (nothing connected)",
    );
    return;
  }

  if (issues.length === 0) {
    log.info(
      {
        event: "social.health_ok",
        tenantId,
        platforms: checkedPlatforms,
        jobId: job.id,
      },
      "social credential health check passed",
    );
    return;
  }

  log.error(
    { event: "social.health_failed", tenantId, issues, jobId: job.id },
    "social credential health check failed",
  );

  if (deps.slackWebhookUrl === undefined || deps.slackWebhookUrl === "") {
    return;
  }

  const slackResult = await postToWebhook({
    url: deps.slackWebhookUrl,
    blocks: buildSlackBlocks(tenantId, issues),
    fetchFn: deps.fetchFn,
  });
  if (!slackResult.ok) {
    log.error(
      {
        event: "social.health_slack_failed",
        tenantId,
        jobId: job.id,
        status: slackResult.status,
      },
      "social credential health slack alert failed",
    );
  }
}
