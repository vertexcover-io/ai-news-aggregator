import {
  dateAtTzTime,
  type PublishChannel,
  type SlackNotifier,
  type UserSettings,
} from "@newsletter/shared";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";

export interface ReviewWarningDeps {
  readonly archiveRepo: RunArchivesRepo;
  readonly userSettingsRepo: UserSettingsRepo;
  readonly slackNotifier?: SlackNotifier;
}

export interface ReviewWarningJobLike {
  readonly name: string;
  readonly id?: string;
  readonly data: { readonly runId: string };
}

interface ReviewWarningTarget {
  readonly channel: PublishChannel;
  readonly hhmm: string;
  readonly date: Date;
}

function enabledTargets(
  settings: UserSettings,
  archive: PipelineRunArchiveRow,
): readonly ReviewWarningTarget[] {
  const now = new Date();
  return [
    {
      channel: "email-send" as const,
      hhmm: settings.emailTime,
      enabled: settings.emailEnabled && archive.emailSentAt === null,
    },
    {
      channel: "linkedin-post" as const,
      hhmm: settings.linkedinTime,
      enabled: settings.linkedinEnabled && archive.linkedinPostedAt === null,
    },
    {
      channel: "twitter-post" as const,
      hhmm: settings.twitterTime,
      enabled: settings.twitterPostEnabled && archive.twitterPostedAt === null,
    },
  ]
    .filter((target) => target.enabled)
    .map((target) => ({
      channel: target.channel,
      hhmm: target.hhmm,
      date: dateAtTzTime(settings.scheduleTimezone, target.hhmm, now),
    }));
}

function earliestEnabledPublish(
  settings: UserSettings,
  archive: PipelineRunArchiveRow,
): { readonly channel: PublishChannel; readonly hhmm: string } | null {
  const targets = enabledTargets(settings, archive);
  if (targets.length === 0) return null;
  const earliest = targets.reduce((min, target) =>
    target.date.getTime() < min.date.getTime() ? target : min,
  );
  return { channel: earliest.channel, hhmm: earliest.hhmm };
}

export async function handleReviewWarningJob(
  deps: ReviewWarningDeps,
  job: ReviewWarningJobLike,
): Promise<void> {
  if (job.name !== "review-warning") return;
  const { runId } = job.data;
  const archive = await deps.archiveRepo.findById(runId);
  if (archive === null || archive.reviewed) return;
  const settings = await deps.userSettingsRepo.get();
  if (settings === null || settings.autoReview) return;
  const earliest = earliestEnabledPublish(settings, archive);
  if (earliest === null) return;
  await deps.slackNotifier?.notifyReviewWarning({
    runId,
    earliestChannel: earliest.channel,
    earliestTime: earliest.hhmm,
    minutesUntil: 5,
  });
}
