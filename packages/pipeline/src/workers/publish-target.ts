import type { PublishChannel, SlackNotifier } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import type {
  PipelineRunArchiveRow,
  RunArchivesRepo,
} from "@pipeline/repositories/run-archives.js";

const logger = createLogger("worker:publish-target");

export interface PublishTargetDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly slackNotifier?: SlackNotifier;
}

export async function resolvePublishTarget(
  deps: PublishTargetDeps,
  input: {
    readonly channel: PublishChannel;
    readonly runId?: string;
  },
): Promise<PipelineRunArchiveRow | null> {
  if (input.runId !== undefined) {
    const archive = await deps.archiveRepo.findById(input.runId);
    if (archive === null) return null;
    if (archive.isDryRun) {
      logger.info(
        { event: "publish.dry_run_bypassed", runId: archive.id, channel: input.channel },
        "skipped: dry-run archive",
      );
      return null;
    }
    if (!archive.reviewed) {
      await deps.slackNotifier?.notifyPublishFailed({
        runId: input.runId,
        channel: input.channel,
        reason: "not_reviewed",
      });
      return null;
    }
    return archive;
  }

  const archive = await deps.archiveRepo.findLatestTerminal();
  if (archive === null) {
    await deps.slackNotifier?.notifyPublishUnavailable?.({
      channel: input.channel,
      reason: "no_archive",
    });
    return null;
  }
  if (archive.isDryRun) {
    logger.info(
      { event: "publish.dry_run_bypassed", runId: archive.id, channel: input.channel },
      "skipped: latest archive is a dry run",
    );
    return null;
  }
  if (archive.status !== "completed") {
    await deps.slackNotifier?.notifyPublishUnavailable?.({
      channel: input.channel,
      reason: archive.status === "cancelled" ? "latest_cancelled" : "latest_failed",
      runId: archive.id,
    });
    return null;
  }
  if (!archive.reviewed) {
    await deps.slackNotifier?.notifyPublishUnavailable?.({
      channel: input.channel,
      reason: "latest_unreviewed",
      runId: archive.id,
    });
    return null;
  }
  return archive;
}
