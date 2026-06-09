import type { Job } from "bullmq";

type CaptureExceptionFn = (error: unknown, context?: Record<string, unknown>) => void;

/**
 * Shared failed-listener body for the 3 BullMQ workers.
 * Captures to PostHog only on the terminal attempt (REQ-007/REQ-008/EDGE-003).
 * Extracted so it can be unit-tested without booting workers (S-global-03: one helper for 3 identical call sites).
 */
export function handleWorkerFailure(
  queue: string,
  job: Job | undefined,
  err: Error,
  captureException: CaptureExceptionFn,
): void {
  if (job === undefined) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= attempts) {
    captureException(err, { queue, jobId: job.id, jobName: job.name });
  }
}
