import { createLogger } from "@newsletter/shared/logger";
import type { SlackNotifier } from "@newsletter/shared";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import type { TwitterNotifier } from "@pipeline/social/twitter/index.js";
import { resolvePublishTarget } from "./publish-target.js";

const logger = createLogger("worker:twitter-post");

export interface TwitterPostDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly twitterNotifier: TwitterNotifier | null;
  readonly slackNotifier?: SlackNotifier;
  // Read per job so the live toggle is honored at execution time — this is the
  // final gate that stops a post even when an upstream path (manual trigger,
  // a job enqueued before the toggle was switched off) failed to gate it.
  readonly userSettingsRepo?: UserSettingsRepo;
}

export interface TwitterPostJobLike {
  readonly name: string;
  readonly id?: string;
  /** `tenantId` (P9, REQ-060): consumed by the dispatcher to scope publish deps. */
  readonly data: { readonly runId?: string; readonly tenantId?: string };
}

export async function handleTwitterPostJob(
  deps: TwitterPostDeps,
  job: TwitterPostJobLike,
): Promise<void> {
  if (job.name !== "twitter-post") return;
  if (deps.userSettingsRepo) {
    const settings = await deps.userSettingsRepo.get();
    if (settings && !settings.twitterPostEnabled) {
      logger.info(
        { event: "publish.skipped_disabled", channel: "twitter-post", runId: job.data.runId },
        "skipped: twitter posting disabled",
      );
      return;
    }
  }
  const archive = await resolvePublishTarget(deps, {
    channel: "twitter-post",
    runId: job.data.runId,
  });
  if (archive === null) return;
  if (archive.twitterPostedAt !== null) return;
  const result = await deps.twitterNotifier?.notifyArchiveReady({ runId: archive.id });
  if (result?.status === "posted" && result.permalink !== null) {
    try {
      await deps.slackNotifier?.notifyTwitterPosted({ runId: archive.id, permalink: result.permalink });
    } catch (err) {
      logger.warn(
        {
          event: "slack.twitter_posted.unexpected_throw",
          runId: archive.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack.twitter_posted.unexpected_throw",
      );
    }
  } else if (result?.status === "failed") {
    try {
      await deps.slackNotifier?.notifyPublishFailed({
        runId: archive.id,
        channel: "twitter-post",
        reason: result.reason,
      });
    } catch (err) {
      logger.warn(
        {
          event: "slack.twitter_failed.unexpected_throw",
          runId: archive.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack.twitter_failed.unexpected_throw",
      );
    }
  }
}
