import type { Job } from "bullmq";
import { buildExceptionTags, type RecordIncidentInput } from "@newsletter/shared/errors";

type CaptureExceptionFn = (error: unknown, context?: Record<string, unknown>) => void;
type RecordIncidentFn = (input: RecordIncidentInput) => void;

export interface WorkerFailureDeps {
  captureException: CaptureExceptionFn;
  recordIncident: RecordIncidentFn;
  /** Best-effort runId extractor (e.g. getRunIdFromJobData) for incident context. */
  getRunId?: (data: unknown) => string | undefined;
}

/**
 * Shared failed-listener body for the 3 BullMQ workers.
 * Fires to PostHog + the incident pipeline ONLY on the terminal attempt
 * (REQ-007/REQ-008/EDGE-003) so retries don't spam. Tags the capture with the
 * shared classification + fingerprint and routes an incident through triage.
 * Extracted so it can be unit-tested without booting workers.
 */
export function handleWorkerFailure(
  queue: string,
  job: Job | undefined,
  err: Error,
  deps: WorkerFailureDeps,
): void {
  if (job === undefined) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) return;

  const runId = deps.getRunId?.(job.data);
  const source = `${queue}:${job.name}`;
  deps.captureException(err, {
    queue,
    jobId: job.id,
    jobName: job.name,
    ...buildExceptionTags(err, {
      sourcePackage: "pipeline",
      source,
      runId,
      jobId: job.id,
    }),
  });
  deps.recordIncident({ err, sourcePackage: "pipeline", source, runId, jobId: job.id });
}
