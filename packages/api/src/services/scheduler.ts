import type { Queue } from "bullmq";
import type { UserSettings } from "@newsletter/shared";

export const DAILY_RUN_SCHEDULER_KEY = "daily-run:default";
export const SOCIAL_HEALTH_SCHEDULER_KEY = "social-health:default";
const SOCIAL_HEALTH_LEAD_MINUTES = 15;

export function toCron(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  return `${m} ${h} * * *`;
}

export function toCronMinusMinutes(hhmm: string, minutesBefore: number): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  const dayMinutes = 24 * 60;
  const total = (h * 60 + m - minutesBefore + dayMinutes) % dayMinutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${minute} ${hour} * * *`;
}

export async function reconcileDailyRunSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
): Promise<void> {
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(DAILY_RUN_SCHEDULER_KEY);
    await queue.removeJobScheduler(SOCIAL_HEALTH_SCHEDULER_KEY);
    return;
  }
  await queue.upsertJobScheduler(
    DAILY_RUN_SCHEDULER_KEY,
    { pattern: toCron(settings.scheduleTime), tz: settings.scheduleTimezone },
    { name: "daily-run", data: {} },
  );
  await queue.upsertJobScheduler(
    SOCIAL_HEALTH_SCHEDULER_KEY,
    {
      pattern: toCronMinusMinutes(
        settings.scheduleTime,
        SOCIAL_HEALTH_LEAD_MINUTES,
      ),
      tz: settings.scheduleTimezone,
    },
    { name: "social-health", data: {} },
  );
}
