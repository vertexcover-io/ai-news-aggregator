import type { Queue } from "bullmq";
import {
  SCHEDULED_CHANNELS,
  jobIdFor,
  publishDateForWindow,
  type PublishChannel,
  type ScheduledChannel,
  type UserSettings,
} from "@newsletter/shared";

export interface ArchiveForSchedule {
  readonly id: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly completedAt: Date;
  readonly emailSentAt: Date | null;
  readonly linkedinPostedAt: Date | null;
  readonly twitterPostedAt: Date | null;
}

export type QueueForSchedule = Pick<Queue, "add" | "remove" | "getJob">;

export interface ReconcilePerArchiveDeps {
  readonly queue: QueueForSchedule;
  readonly now?: () => Date;
}

export interface ReconcilePerArchiveResult {
  readonly removed: readonly ScheduledChannel[];
  readonly enqueued: readonly ScheduledChannel[];
}

interface ChannelTarget {
  readonly channel: PublishChannel;
  readonly enabled: boolean;
  readonly completed: boolean;
  readonly hhmm: string;
}

function channelTargets(
  settings: UserSettings,
  archive: ArchiveForSchedule,
): readonly ChannelTarget[] {
  return [
    {
      channel: "email-send",
      enabled: settings.emailEnabled,
      completed: archive.emailSentAt !== null,
      hhmm: settings.emailTime,
    },
    {
      channel: "linkedin-post",
      enabled: settings.linkedinEnabled,
      completed: archive.linkedinPostedAt !== null,
      hhmm: settings.linkedinTime,
    },
    {
      channel: "twitter-post",
      enabled: settings.twitterPostEnabled,
      completed: archive.twitterPostedAt !== null,
      hhmm: settings.twitterTime,
    },
  ];
}

function delayUntil(target: Date, now: Date): number {
  return Math.max(0, target.getTime() - now.getTime());
}

function enabledPublishTargets(
  settings: UserSettings,
  archive: ArchiveForSchedule,
): readonly { readonly channel: PublishChannel; readonly date: Date; readonly hhmm: string }[] {
  return channelTargets(settings, archive)
    .filter((target) => target.enabled && !target.completed)
    .map((target) => ({
      channel: target.channel,
      date: publishDateForWindow({
        timezone: settings.scheduleTimezone,
        pipelineTime: settings.pipelineTime,
        publishTime: target.hhmm,
        completedAt: archive.completedAt,
      }),
      hhmm: target.hhmm,
    }));
}

async function removeJob(
  queue: QueueForSchedule,
  channel: ScheduledChannel,
  runId: string,
): Promise<ScheduledChannel> {
  try {
    await queue.remove(jobIdFor(channel, runId));
  } catch {
    // BullMQ treats absent delayed jobs as operationally harmless here: the
    // reconciler's goal is desired state, and a missing old job already matches
    // the "removed" half of that diff.
  }
  return channel;
}

async function enqueueJob(input: {
  readonly queue: QueueForSchedule;
  readonly channel: ScheduledChannel;
  readonly runId: string;
  readonly delay: number;
}): Promise<ScheduledChannel> {
  await input.queue.add(
    input.channel,
    { runId: input.runId },
    { jobId: jobIdFor(input.channel, input.runId), delay: input.delay },
  );
  return input.channel;
}

export async function reconcilePerArchiveJobs(
  deps: ReconcilePerArchiveDeps,
  runId: string,
  settings: UserSettings,
  archive: ArchiveForSchedule,
): Promise<ReconcilePerArchiveResult> {
  const now = (deps.now ?? (() => new Date()))();
  const shouldRemoveAll = archive.status !== "completed" || !settings.scheduleEnabled;
  const removed: ScheduledChannel[] = [];
  const enqueued: ScheduledChannel[] = [];

  if (shouldRemoveAll) {
    for (const channel of SCHEDULED_CHANNELS) {
      removed.push(await removeJob(deps.queue, channel, runId));
    }
    return { removed, enqueued };
  }

  for (const target of channelTargets(settings, archive)) {
    if (!target.enabled || target.completed) {
      removed.push(await removeJob(deps.queue, target.channel, runId));
      continue;
    }

    const date = publishDateForWindow({
      timezone: settings.scheduleTimezone,
      pipelineTime: settings.pipelineTime,
      publishTime: target.hhmm,
      completedAt: archive.completedAt,
    });
    removed.push(await removeJob(deps.queue, target.channel, runId));
    enqueued.push(
      await enqueueJob({
        queue: deps.queue,
        channel: target.channel,
        runId,
        delay: delayUntil(date, now),
      }),
    );
  }

  const publishTargets = enabledPublishTargets(settings, archive);
  if (settings.autoReview || publishTargets.length === 0) {
    removed.push(await removeJob(deps.queue, "review-warning", runId));
    return { removed, enqueued };
  }

  const earliest = publishTargets.reduce((min, target) =>
    target.date.getTime() < min.date.getTime() ? target : min,
  );
  const warningAt = new Date(earliest.date.getTime() - 5 * 60 * 1000);
  removed.push(await removeJob(deps.queue, "review-warning", runId));
  enqueued.push(
    await enqueueJob({
      queue: deps.queue,
      channel: "review-warning",
      runId,
      delay: delayUntil(warningAt, now),
    }),
  );

  return { removed, enqueued };
}

export function earliestEnabledPublish(
  settings: UserSettings,
  archive: ArchiveForSchedule,
): { readonly channel: PublishChannel; readonly hhmm: string } | null {
  const targets = enabledPublishTargets(settings, archive);
  if (targets.length === 0) return null;
  const earliest = targets.reduce((min, target) =>
    target.date.getTime() < min.date.getTime() ? target : min,
  );
  return { channel: earliest.channel, hhmm: earliest.hhmm };
}
