import type { Logger } from "@newsletter/shared/logger";

import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

import { composePosts, type RankedStory } from "../compose.js";
import type { SocialResult } from "../types.js";
import type { TwitterApiClient } from "./types.js";

const FAILURE_BODY_MAX = 500;
const AUTH_RETRY_STATUSES = new Set([401, 403]);

export interface TwitterNotifierConfig {
  publicArchiveBaseUrl: string;
  twitterIsPremium?: boolean;
}

export interface TwitterNotifierDeps {
  apiClient: TwitterApiClient;
  archives: Pick<
    RunArchivesRepo,
    "findById" | "markTwitterPosted" | "recordSocialFailure"
  >;
  rawItems: Pick<RawItemsRepo, "findByIds">;
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

function truncate(value: string): string {
  if (value.length <= FAILURE_BODY_MAX) return value;
  return `${value.slice(0, FAILURE_BODY_MAX)}…`;
}

function postFailureReason(status: number): string {
  if (AUTH_RETRY_STATUSES.has(status)) return "auth_failed";
  return `http_${status}`;
}

function stripTrailingSlash(value: string): string {
  if (value.endsWith("/")) return value.slice(0, -1);
  return value;
}

interface ArchiveLike {
  rankedItems: { rawItemId: number; title?: string; summary?: string }[];
}

async function buildStories(
  archive: ArchiveLike,
  rawItems: Pick<RawItemsRepo, "findByIds">,
): Promise<RankedStory[]> {
  const ids = archive.rankedItems.map((r) => r.rawItemId);
  if (ids.length === 0) return [];
  const rows = await rawItems.findByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return archive.rankedItems
    .map((ref) => {
      const raw = byId.get(ref.rawItemId);
      const recap = raw?.metadata.recap;
      return {
        title: ref.title ?? recap?.title ?? raw?.title ?? "",
        summary: ref.summary ?? recap?.summary ?? "",
      };
    })
    .filter((story) => story.title.trim() !== "");
}

export function createTwitterNotifier(
  deps: TwitterNotifierDeps,
): TwitterNotifier {
  const { apiClient, archives, rawItems, config, logger } = deps;
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

        const socialSummary = archive.twitterSummary ?? archive.hook;
        if (socialSummary === null || socialSummary.trim() === "") {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (no twitter summary)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const stories = config.twitterIsPremium === true
          ? await buildStories(archive, rawItems)
          : [];
        const archiveUrl = `${stripTrailingSlash(config.publicArchiveBaseUrl)}/archive/${runId}`;
        const composed = composePosts({
          heading: archive.digestHeadline,
          hook: archive.hook,
          twitterSummary: archive.twitterSummary,
          twitterIsPremium: config.twitterIsPremium === true,
          stories,
        });
        if (composed === null) {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (compose returned null)",
          );
          return { status: "skipped", reason: "no_headline" };
        }
        if (!composed.twitter.ok) {
          await archives.recordSocialFailure(
            runId,
            "twitter",
            composed.twitter.reason,
          );
          logger.warn(
            {
              event: "social.twitter.skipped",
              reason: composed.twitter.reason,
              runId,
            },
            "twitter notification skipped (composition invalid)",
          );
          return { status: "failed", reason: composed.twitter.reason };
        }

        const headResult = await apiClient.createPost({
          text: composed.twitter.text,
        });

        if (!headResult.ok) {
          const reason = postFailureReason(headResult.status);
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
          return { status: "failed", reason };
        }

        const tweetIds: string[] = [headResult.tweetId];
        const replyResult = await apiClient.createPost({
          text: archiveUrl,
          replyToTweetId: headResult.tweetId,
        });
        if (replyResult.ok) {
          tweetIds.push(replyResult.tweetId);
          logger.info(
            {
              event: "social.twitter.reply_sent",
              runId,
              replyId: replyResult.tweetId,
            },
            "twitter link reply created",
          );
        } else {
          logger.warn(
            {
              event: "social.twitter.reply_failed",
              runId,
              status: replyResult.status,
              body: truncate(replyResult.body),
            },
            "twitter post created but link reply failed",
          );
        }

        await archives.markTwitterPosted(
          runId,
          now(),
          headResult.tweetUrl,
          tweetIds,
        );
        logger.info(
          {
            event: "social.twitter.sent",
            runId,
            permalink: headResult.tweetUrl,
            tweetCount: tweetIds.length,
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
