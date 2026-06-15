import { createLogger } from "@newsletter/shared/logger";
import type { SlackNotifier } from "@newsletter/shared";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import type { LinkedInNotifier } from "@pipeline/social/linkedin/index.js";
import { resolvePublishTarget } from "./publish-target.js";

const logger = createLogger("worker:linkedin-post");

export interface LinkedInPostDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly linkedinNotifier: LinkedInNotifier | null;
  readonly slackNotifier?: SlackNotifier;
  // Read per job so the live toggle is honored at execution time — this is the
  // final gate that stops a post even when an upstream path (manual trigger,
  // a job enqueued before the toggle was switched off) failed to gate it.
  readonly userSettingsRepo?: UserSettingsRepo;
}

export interface LinkedInPostJobLike {
  readonly name: string;
  readonly id?: string;
  readonly data: { readonly runId?: string };
}

export async function handleLinkedInPostJob(
  deps: LinkedInPostDeps,
  job: LinkedInPostJobLike,
): Promise<void> {
  if (job.name !== "linkedin-post") return;
  if (deps.userSettingsRepo) {
    const settings = await deps.userSettingsRepo.get();
    if (settings && !settings.linkedinEnabled) {
      logger.info(
        { event: "publish.skipped_disabled", channel: "linkedin-post", runId: job.data.runId },
        "skipped: linkedin posting disabled",
      );
      return;
    }
  }
  const archive = await resolvePublishTarget(deps, {
    channel: "linkedin-post",
    runId: job.data.runId,
  });
  if (archive === null) return;
  if (archive.linkedinPostedAt !== null) return;
  const result = await deps.linkedinNotifier?.notifyArchiveReady({ runId: archive.id });
  if (result?.status === "posted" && result.permalink !== null) {
    try {
      await deps.slackNotifier?.notifyLinkedinPosted({ runId: archive.id, permalink: result.permalink });
    } catch (err) {
      logger.warn(
        {
          event: "slack.linkedin_posted.unexpected_throw",
          runId: archive.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack.linkedin_posted.unexpected_throw",
      );
    }
  } else if (result?.status === "failed") {
    try {
      await deps.slackNotifier?.notifyPublishFailed({
        runId: archive.id,
        channel: "linkedin-post",
        reason: result.reason,
      });
    } catch (err) {
      logger.warn(
        {
          event: "slack.linkedin_failed.unexpected_throw",
          runId: archive.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack.linkedin_failed.unexpected_throw",
      );
    }
  }
}
