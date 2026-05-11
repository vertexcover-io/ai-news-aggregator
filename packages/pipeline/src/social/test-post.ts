import {
  socialTestKey,
  SOCIAL_TEST_TTL_SECONDS,
  type SocialTestResult,
} from "@newsletter/shared";
import type { Logger } from "@newsletter/shared/logger";

import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";
import type { SocialTestPostJobData } from "@pipeline/queues/social-test-post.js";

import type { LinkedInApiClient } from "./linkedin/types.js";
import type { TwitterApiClient } from "./twitter/types.js";
import { refreshLinkedInToken } from "./linkedin/oauth.js";
import { refreshTwitterToken } from "./twitter/oauth.js";

const REFRESH_SKEW_MS = 60_000;
const FAILURE_BODY_MAX = 500;

export interface SocialTestPostConfig {
  linkedinApiVersion: string;
  linkedinClientId: string;
  linkedinClientSecret: string;
  twitterClientId: string;
  twitterClientSecret: string;
}

export interface SocialTestPostRedis {
  setex(key: string, ttl: number, value: string): Promise<unknown>;
}

export interface SocialTestPostDeps {
  linkedinApiClient: LinkedInApiClient | null;
  twitterApiClient: TwitterApiClient | null;
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  refreshLinkedIn?: typeof refreshLinkedInToken;
  refreshTwitter?: typeof refreshTwitterToken;
  config: SocialTestPostConfig;
  redis: SocialTestPostRedis;
  logger: Logger;
  now?: () => Date;
}

export interface SocialTestPostJob {
  data: SocialTestPostJobData;
}

function truncate(value: string): string {
  if (value.length <= FAILURE_BODY_MAX) return value;
  return `${value.slice(0, FAILURE_BODY_MAX)}…`;
}

function buildText(now: Date): string {
  return `[Test post — please ignore] ${now.toISOString()}`;
}

type LinkedInAcquire =
  | { ok: true; accessToken: string; personUrn: string }
  | { ok: false; result: SocialTestResult };

type TwitterAcquire =
  | { ok: true; accessToken: string }
  | { ok: false; result: SocialTestResult };

async function acquireLinkedIn(
  deps: SocialTestPostDeps,
  now: Date,
): Promise<LinkedInAcquire> {
  const refreshFn = deps.refreshLinkedIn ?? refreshLinkedInToken;
  return deps.tokens.withTokenLock<LinkedInAcquire>(
    "linkedin",
    async (row, tx) => {
      if (row === null) {
        return { ok: false, result: { status: "failed", error: "no_token" } };
      }
      let accessToken = row.accessToken;
      const needsRefresh =
        row.expiresAt.getTime() <= now.getTime() + REFRESH_SKEW_MS;
      if (needsRefresh) {
        const refreshed = await refreshFn({
          clientId: deps.config.linkedinClientId,
          clientSecret: deps.config.linkedinClientSecret,
          refreshToken: row.refreshToken,
        });
        if (!refreshed.ok) {
          return {
            ok: false,
            result: { status: "failed", error: "refresh_failed" },
          };
        }
        accessToken = refreshed.accessToken;
        await tx.saveToken("linkedin", {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          metadata: row.metadata,
        });
      }
      const personUrn = row.metadata?.personUrn;
      if (typeof personUrn !== "string" || personUrn === "") {
        return {
          ok: false,
          result: { status: "failed", error: "no_person_urn" },
        };
      }
      return { ok: true, accessToken, personUrn };
    },
  );
}

async function acquireTwitter(
  deps: SocialTestPostDeps,
  now: Date,
): Promise<TwitterAcquire> {
  const refreshFn = deps.refreshTwitter ?? refreshTwitterToken;
  return deps.tokens.withTokenLock<TwitterAcquire>(
    "twitter",
    async (row, tx) => {
      if (row === null) {
        return { ok: false, result: { status: "failed", error: "no_token" } };
      }
      let accessToken = row.accessToken;
      const needsRefresh =
        row.expiresAt.getTime() <= now.getTime() + REFRESH_SKEW_MS;
      if (needsRefresh) {
        const refreshed = await refreshFn({
          clientId: deps.config.twitterClientId,
          clientSecret: deps.config.twitterClientSecret,
          refreshToken: row.refreshToken,
        });
        if (!refreshed.ok) {
          return {
            ok: false,
            result: { status: "failed", error: "refresh_failed" },
          };
        }
        accessToken = refreshed.accessToken;
        await tx.saveToken("twitter", {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          metadata: row.metadata,
        });
      }
      return { ok: true, accessToken };
    },
  );
}

async function runLinkedIn(
  deps: SocialTestPostDeps,
  now: Date,
): Promise<SocialTestResult> {
  if (deps.linkedinApiClient === null) {
    return { status: "failed", error: "not_configured" };
  }
  const acquired = await acquireLinkedIn(deps, now);
  if (!acquired.ok) return acquired.result;
  const text = buildText(now);
  const post = await deps.linkedinApiClient.createPost({
    accessToken: acquired.accessToken,
    personUrn: acquired.personUrn,
    text,
    apiVersion: deps.config.linkedinApiVersion,
  });
  if (post.ok) {
    return { status: "posted", permalink: post.postUrn };
  }
  if (post.status === 422 && post.errorCode === "DUPLICATE_POST") {
    return { status: "posted", permalink: null };
  }
  return {
    status: "failed",
    error: `http_${post.status}:${truncate(post.body)}`,
  };
}

async function runTwitter(
  deps: SocialTestPostDeps,
  now: Date,
): Promise<SocialTestResult> {
  if (deps.twitterApiClient === null) {
    return { status: "failed", error: "not_configured" };
  }
  const acquired = await acquireTwitter(deps, now);
  if (!acquired.ok) return acquired.result;
  const text = buildText(now);
  const post = await deps.twitterApiClient.createPost({
    accessToken: acquired.accessToken,
    text,
  });
  if (post.ok) {
    return { status: "posted", permalink: post.tweetUrl };
  }
  return {
    status: "failed",
    error: `http_${post.status}:${truncate(post.body)}`,
  };
}

export async function handleSocialTestPostJob(
  deps: SocialTestPostDeps,
  job: SocialTestPostJob,
): Promise<void> {
  const { platform, requestId } = job.data;
  const now = (deps.now ?? ((): Date => new Date()))();
  let result: SocialTestResult;
  try {
    if (platform === "linkedin") {
      result = await runLinkedIn(deps, now);
    } else {
      result = await runTwitter(deps, now);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.error(
      { event: "social.test_post.unexpected", platform, requestId, error: message },
      "social test post threw unexpectedly",
    );
    result = { status: "failed", error: `unexpected:${message}` };
  }
  try {
    await deps.redis.setex(
      socialTestKey(requestId),
      SOCIAL_TEST_TTL_SECONDS,
      JSON.stringify(result),
    );
    deps.logger.info(
      { event: "social.test_post.completed", platform, requestId, status: result.status },
      "social test post completed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.error(
      { event: "social.test_post.redis_failed", platform, requestId, error: message },
      "social test post redis write failed",
    );
  }
}
