import { publishDateForWindow } from "./tz.js";

export interface ScheduledPublishInput {
  readonly scheduleTimezone: string | null | undefined;
  readonly pipelineTime: string | null | undefined;
  readonly emailTime: string | null | undefined;
  readonly completedAt: Date;
}

// Returns the scheduled publish datetime, or null when it cannot be computed
// (missing settings, emailTime === pipelineTime, or malformed HH:MM). Never throws.
export function resolveScheduledPublishAt(input: ScheduledPublishInput): Date | null {
  const { scheduleTimezone, pipelineTime, emailTime, completedAt } = input;
  if (!scheduleTimezone || !pipelineTime || !emailTime) return null;
  try {
    return publishDateForWindow({
      timezone: scheduleTimezone,
      pipelineTime,
      publishTime: emailTime,
      completedAt,
    });
  } catch {
    return null;
  }
}
