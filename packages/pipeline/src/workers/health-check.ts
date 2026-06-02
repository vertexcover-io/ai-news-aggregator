import { createLogger, type Logger } from "@newsletter/shared/logger";
import type { HealthCheckReport, HealthCheckJobData, CollectorType } from "@newsletter/shared/types";

const logger = createLogger("worker:health-check");

export interface HealthCheckJobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

export interface HealthCheckDeps {
  /** Runs the health checks and returns a report. */
  runHealthChecks: (options?: { collectorType?: CollectorType }) => Promise<HealthCheckReport>;
  /** Sends a Slack notification for failed health checks. */
  notifyHealthCheckFailed: (input: { report: HealthCheckReport }) => Promise<void>;
  /** Returns true if the same failure set was recently notified (debounced). */
  checkDebounce?: (report: HealthCheckReport) => Promise<boolean>;
  /** Marks the current failure set as notified (for debounce). */
  markDebounce?: (report: HealthCheckReport) => Promise<void>;
  logger?: Logger;
}

export async function handleHealthCheckJob(
  deps: HealthCheckDeps,
  job: HealthCheckJobLike,
): Promise<void> {
  if (job.name !== "health-check") return;

  const log = deps.logger ?? logger;
  const data = job.data as Partial<HealthCheckJobData>;
  const triggeredBy = data.triggeredBy ?? "scheduled";
  const collectorType = data.collectorType;

  log.info(
    { event: "health_check.started", jobId: job.id, triggeredBy, collectorType },
    "health check started",
  );

  const report = await deps.runHealthChecks(
    collectorType ? { collectorType } : undefined,
  );

  log.info(
    {
      event: "health_check.completed",
      jobId: job.id,
      healthyCount: report.healthyCount,
      failedCount: report.failedCount,
      skippedCount: report.skippedCount,
      totalDurationMs: report.totalDurationMs,
    },
    "health check completed",
  );

  // Only send Slack notifications for scheduled auto-checks with failures
  if (report.failedCount === 0) {
    log.info(
      { event: "health_check.all_healthy", jobId: job.id },
      "all collectors healthy",
    );
    return;
  }

  // Manual triggers always notify; scheduled checks are debounced
  if (triggeredBy === "scheduled" && deps.checkDebounce) {
    const isDebounced = await deps.checkDebounce(report);
    if (isDebounced) {
      log.info(
        { event: "health_check.debounced", jobId: job.id },
        "health check notification debounced (same failures within window)",
      );
      return;
    }
  }

  await deps.notifyHealthCheckFailed({ report });

  // Mark debounce after successful notification
  if (triggeredBy === "scheduled" && deps.markDebounce) {
    await deps.markDebounce(report);
  }

  log.info(
    { event: "health_check.notified", jobId: job.id, failedCount: report.failedCount },
    "health check failure notification sent",
  );
}
