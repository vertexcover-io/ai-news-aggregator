import { Queue, type JobsOptions, type QueueOptions } from "bullmq";

import { createRedisConnection } from "./redis.js";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Retention applied to every queue built by {@link createQueue}.
 *
 * BullMQ's default is to keep completed and failed jobs forever. With eight
 * repeatable schedulers firing daily across three tenants that grew to ~1000
 * completed jobs and ~860 orphaned job hashes in three months — each
 * `pipeline-run` hash carrying its full `data` and `returnvalue` payload.
 *
 * The `age`/`count` pair is an OR: a job is dropped once it is older than
 * `age` OR once it falls outside the newest `count`. Failures are kept longer
 * and deeper than successes because they are what gets debugged.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 7 * DAY_SECONDS, count: 200 },
  removeOnFail: { age: 30 * DAY_SECONDS, count: 500 },
};

export type CreateQueueOptions = Omit<QueueOptions, "connection"> & {
  connection?: QueueOptions["connection"];
};

/**
 * Build a BullMQ queue with the shared retention defaults.
 *
 * Always prefer this over `new Queue(...)` — a bare queue keeps every job it
 * ever ran. Queue-level `defaultJobOptions` also reach repeatable jobs:
 * `upsertJobScheduler` merges them into the stored job template, so scheduler
 * iterations inherit the same retention.
 *
 * Callers may override `defaultJobOptions`; doing so replaces the defaults
 * wholesale, so spread {@link DEFAULT_JOB_OPTIONS} if you only mean to add.
 */
export function createQueue<DataType = unknown>(
  name: string,
  opts?: CreateQueueOptions,
): Queue<DataType> {
  const { connection, defaultJobOptions, ...rest } = opts ?? {};
  return new Queue<DataType>(name, {
    ...rest,
    connection: connection ?? createRedisConnection(),
    defaultJobOptions: defaultJobOptions ?? DEFAULT_JOB_OPTIONS,
  });
}
