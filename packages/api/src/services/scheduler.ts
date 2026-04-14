import type { Queue } from "bullmq";
import type { UserSettings } from "@newsletter/shared";

export const DAILY_RUN_SCHEDULER_KEY = "daily-run:default";

export function toCron(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  return `${m} ${h} * * *`;
}

export async function reconcileDailyRunSchedule(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  settings: UserSettings,
): Promise<void> {
  const key = DAILY_RUN_SCHEDULER_KEY;
  if (!settings.scheduleEnabled) {
    await queue.removeJobScheduler(key);
    return;
  }
  await queue.upsertJobScheduler(
    key,
    { pattern: toCron(settings.scheduleTime), tz: settings.scheduleTimezone },
    { name: "daily-run", data: {} },
  );
}
