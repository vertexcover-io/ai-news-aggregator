import { createLogger } from "@newsletter/shared/logger";
import type { SlackNotifier } from "@newsletter/shared";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { TwitterNotifier } from "@pipeline/social/twitter/index.js";
import { resolvePublishTarget } from "./publish-target.js";

const logger = createLogger("worker:twitter-post");

export interface TwitterPostDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly twitterNotifier: TwitterNotifier | null;
  readonly slackNotifier?: SlackNotifier;
}

export interface TwitterPostJobLike {
  readonly name: string;
  readonly id?: string;
  readonly data: { readonly runId?: string };
}

export async function handleTwitterPostJob(
  deps: TwitterPostDeps,
  job: TwitterPostJobLike,
): Promise<void> {
  if (job.name !== "twitter-post") return;
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
