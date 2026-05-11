import type { Logger } from "@newsletter/shared/logger";

import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

import { composePosts } from "../compose.js";
import type { SocialResult } from "../types.js";
import type { TwitterApiClient } from "./types.js";
import { refreshTwitterToken } from "./oauth.js";

const REFRESH_SKEW_MS = 60_000;
const FAILURE_BODY_MAX = 500;
const AUTH_RETRY_STATUSES = new Set([401, 403]);

export interface TwitterNotifierConfig {
  clientId: string;
  clientSecret: string;
  publicArchiveBaseUrl: string;
}

export interface TwitterNotifierDeps {
  apiClient: TwitterApiClient;
  archives: Pick<
    RunArchivesRepo,
    "findById" | "markTwitterPosted" | "recordSocialFailure"
  >;
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  refreshFn?: typeof refreshTwitterToken;
  config: TwitterNotifierConfig;
  logger: Logger;
  now?: () => Date;
}

export interface NotifyArchiveReadyInput {
  runId: string;
}

export interface TwitterNotifier {
  notifyArchiveReady(input: NotifyArchiveReadyInput): Promise<SocialResult>;
}

type AcquireResult =
  | { ok: true; accessToken: string }
  | { ok: false; result: SocialResult };

function truncate(value: string): string {
  if (value.length <= FAILURE_BODY_MAX) return value;
  return `${value.slice(0, FAILURE_BODY_MAX)}…`;
}

function stripTrailingSlash(value: string): string {
  if (value.endsWith("/")) return value.slice(0, -1);
  return value;
}

export function createTwitterNotifier(
  deps: TwitterNotifierDeps,
): TwitterNotifier {
  const { apiClient, archives, tokens, config, logger } = deps;
  const refreshFn = deps.refreshFn ?? refreshTwitterToken;
  const now = deps.now ?? ((): Date => new Date());

  return {
    async notifyArchiveReady(
      input: NotifyArchiveReadyInput,
    ): Promise<SocialResult> {
      const { runId } = input;
      try {
        const archive = await archives.findById(runId);
        if (archive === null) {
          logger.error(
            { event: "social.twitter.archive_missing", runId },
            "twitter archive missing",
          );
          return { status: "failed", reason: "archive_missing" };
        }

        if (archive.twitterPostedAt !== null) {
          logger.info(
            {
              event: "social.twitter.skipped",
              reason: "already_posted",
              runId,
            },
            "twitter notification skipped (already posted)",
          );
          return { status: "skipped", reason: "already_posted" };
        }

        const headline = archive.digestHeadline;
        if (headline === null || headline.trim() === "") {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (no headline)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const archiveUrl = `${stripTrailingSlash(config.publicArchiveBaseUrl)}/archive/${runId}`;
        const composed = composePosts({
          digestHeadline: headline,
          digestSummary: archive.digestSummary,
          archiveUrl,
        });
        if (composed === null) {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (compose returned null)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const acquire = (forceRefresh: boolean): Promise<AcquireResult> =>
          tokens.withTokenLock<AcquireResult>("twitter", async (row, tx) => {
            if (row === null) {
              logger.warn(
                { event: "social.twitter.skipped", reason: "no_token", runId },
                "twitter token row missing",
              );
              return {
                ok: false,
                result: { status: "skipped", reason: "no_token" },
              };
            }

            const expiredPerDb =
              row.expiresAt.getTime() <= now().getTime() + REFRESH_SKEW_MS;
            if (!forceRefresh && !expiredPerDb) {
              return { ok: true, accessToken: row.accessToken };
            }

            const refreshed = await refreshFn({
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              refreshToken: row.refreshToken,
            });
            if (!refreshed.ok) {
              logger.error(
                {
                  event: "social.twitter.refresh_failed",
                  runId,
                  status: refreshed.status,
                  forced: forceRefresh,
                },
                "twitter token refresh failed",
              );
              return {
                ok: false,
                result: { status: "failed", reason: "refresh_failed" },
              };
            }
            await tx.saveToken("twitter", {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
              metadata: row.metadata,
            });
            return { ok: true, accessToken: refreshed.accessToken };
          });

        const acquired = await acquire(false);
        if (!acquired.ok) {
          return acquired.result;
        }

        let postResult = await apiClient.createPost({
          accessToken: acquired.accessToken,
          text: composed.twitterText,
        });

        // Reactive refresh: if the platform rejects on auth (401/403), force a
        // refresh and retry once. Guards against silent token invalidation that
        // bypassed our TTL check.
        if (!postResult.ok && AUTH_RETRY_STATUSES.has(postResult.status)) {
          logger.warn(
            {
              event: "social.twitter.auth_retry",
              runId,
              status: postResult.status,
            },
            "twitter post got auth error; forcing refresh and retrying once",
          );
          const reacquired = await acquire(true);
          if (!reacquired.ok) {
            await archives.recordSocialFailure(
              runId,
              "twitter",
              `${postResult.status}:${truncate(postResult.body)}`,
            );
            return reacquired.result;
          }
          postResult = await apiClient.createPost({
            accessToken: reacquired.accessToken,
            text: composed.twitterText,
          });
        }

        if (postResult.ok) {
          await archives.markTwitterPosted(runId, now(), postResult.tweetUrl);
          logger.info(
            {
              event: "social.twitter.sent",
              runId,
              permalink: postResult.tweetUrl,
            },
            "twitter post created",
          );
          return { status: "posted", permalink: postResult.tweetUrl };
        }

        await archives.recordSocialFailure(
          runId,
          "twitter",
          `${postResult.status}:${truncate(postResult.body)}`,
        );
        logger.error(
          {
            event: "social.twitter.post_failed",
            runId,
            status: postResult.status,
          },
          "twitter post failed",
        );
        return { status: "failed", reason: `http_${postResult.status}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { event: "social.twitter.unexpected", runId, error: message },
          "twitter notifier threw unexpectedly",
        );
        return { status: "failed", reason: "unexpected" };
      }
    },
  };
}
