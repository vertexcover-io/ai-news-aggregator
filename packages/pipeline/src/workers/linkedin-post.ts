import { createLogger } from "@newsletter/shared/logger";
import type { SlackNotifier } from "@newsletter/shared";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { LinkedInNotifier } from "@pipeline/social/linkedin/index.js";
import { resolvePublishTarget } from "./publish-target.js";

const logger = createLogger("worker:linkedin-post");

export interface LinkedInPostDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly linkedinNotifier: LinkedInNotifier | null;
  readonly slackNotifier?: SlackNotifier;
}

export interface LinkedInPostJobLike {
  readonly name: string;
  readonly id?: string;
  /** `tenantId` (P9, REQ-060): consumed by the dispatcher to scope publish deps. */
  readonly data: { readonly runId?: string; readonly tenantId?: string };
}

export async function handleLinkedInPostJob(
  deps: LinkedInPostDeps,
  job: LinkedInPostJobLike,
): Promise<void> {
  if (job.name !== "linkedin-post") return;
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
