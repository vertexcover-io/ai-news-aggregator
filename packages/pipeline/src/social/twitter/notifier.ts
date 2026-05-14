import type { Logger } from "@newsletter/shared/logger";

import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

import { composePosts, type RankedStory } from "../compose.js";
import type { SocialResult } from "../types.js";
import type { TwitterApiClient, TwitterCreatePostResult } from "./types.js";
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
  rawItems: Pick<RawItemsRepo, "findByIds">;
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

interface ArchiveLike {
  rankedItems: { rawItemId: number; title?: string; summary?: string }[];
  hook: string | null;
  tldr: string | null;
}

async function buildStories(
  archive: ArchiveLike,
  rawItems: Pick<RawItemsRepo, "findByIds">,
): Promise<RankedStory[]> {
  const ids = archive.rankedItems.map((r) => r.rawItemId);
  if (ids.length === 0) return [];
  const rows = await rawItems.findByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stories: RankedStory[] = [];
  for (const ref of archive.rankedItems) {
    const raw = byId.get(ref.rawItemId);
    const recap = raw?.metadata.recap;
    const title = ref.title ?? recap?.title ?? raw?.title ?? "";
    const summary = ref.summary ?? recap?.summary ?? "";
    if (title.trim() === "" || summary.trim() === "") continue;
    stories.push({ title, summary });
  }
  return stories;
}

export function createTwitterNotifier(
  deps: TwitterNotifierDeps,
): TwitterNotifier {
  const { apiClient, archives, rawItems, tokens, config, logger } = deps;
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

        const hook = archive.hook;
        if (hook === null || hook.trim() === "") {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (no hook)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const stories = await buildStories(archive, rawItems);
        const archiveUrl = `${stripTrailingSlash(config.publicArchiveBaseUrl)}/archive/${runId}`;
        const composed = composePosts({
          hook,
          tldr: archive.tldr,
          stories,
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

        // First tweet (head of thread). Reactive auth-retry if needed.
        let headResult = await apiClient.createPost({
          accessToken: acquired.accessToken,
          text: composed.twitterThread[0],
        });

        if (!headResult.ok && AUTH_RETRY_STATUSES.has(headResult.status)) {
          logger.warn(
            {
              event: "social.twitter.auth_retry",
              runId,
              status: headResult.status,
            },
            "twitter post got auth error; forcing refresh and retrying once",
          );
          const reacquired = await acquire(true);
          if (!reacquired.ok) {
            await archives.recordSocialFailure(
              runId,
              "twitter",
              `${headResult.status}:${truncate(headResult.body)}`,
            );
            return reacquired.result;
          }
          headResult = await apiClient.createPost({
            accessToken: reacquired.accessToken,
            text: composed.twitterThread[0],
          });
        }

        if (!headResult.ok) {
          await archives.recordSocialFailure(
            runId,
            "twitter",
            `${headResult.status}:${truncate(headResult.body)}`,
          );
          logger.error(
            {
              event: "social.twitter.post_failed",
              runId,
              status: headResult.status,
            },
            "twitter post failed",
          );
          return { status: "failed", reason: `http_${headResult.status}` };
        }

        // Thread continues: post tweets 2..N as replies to the previous tweet.
        // A failure mid-thread is logged but the head tweet stays posted —
        // we mark the run as `posted` because the headline tweet is live.
        const threadIds: string[] = [headResult.tweetId];
        const accessTokenForThread = acquired.accessToken;
        let previousTweetId = headResult.tweetId;
        for (let i = 1; i < composed.twitterThread.length; i += 1) {
          const result: TwitterCreatePostResult = await apiClient.createPost({
            accessToken: accessTokenForThread,
            text: composed.twitterThread[i],
            replyToTweetId: previousTweetId,
          });
          if (!result.ok) {
            logger.warn(
              {
                event: "social.twitter.thread_partial_failure",
                runId,
                tweetIndex: i,
                status: result.status,
              },
              "twitter thread partial failure; keeping head tweet posted",
            );
            break;
          }
          threadIds.push(result.tweetId);
          previousTweetId = result.tweetId;
        }

        await archives.markTwitterPosted(
          runId,
          now(),
          headResult.tweetUrl,
          threadIds,
        );
        logger.info(
          {
            event: "social.twitter.sent",
            runId,
            permalink: headResult.tweetUrl,
            threadCount: threadIds.length,
          },
          "twitter post created",
        );
        return { status: "posted", permalink: headResult.tweetUrl };
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
