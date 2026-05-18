import type { SlackNotifier } from "@newsletter/shared";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { TwitterNotifier } from "@pipeline/social/twitter/index.js";

export interface TwitterPostDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly twitterNotifier: TwitterNotifier | null;
  readonly slackNotifier?: SlackNotifier;
}

export interface TwitterPostJobLike {
  readonly name: string;
  readonly id?: string;
  readonly data: { readonly runId: string };
}

export async function handleTwitterPostJob(
  deps: TwitterPostDeps,
  job: TwitterPostJobLike,
): Promise<void> {
  if (job.name !== "twitter-post") return;
  const { runId } = job.data;
  const archive = await deps.archiveRepo.findById(runId);
  if (archive === null) return;
  if (!archive.reviewed) {
    await deps.slackNotifier?.notifyPublishFailed({ runId, channel: "twitter-post" });
    return;
  }
  if (archive.twitterPostedAt !== null) return;
  await deps.twitterNotifier?.notifyArchiveReady({ runId });
}
