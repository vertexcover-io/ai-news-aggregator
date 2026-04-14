import type { ReactElement } from "react";
import { Clock } from "lucide-react";

interface ScheduleBannerProps {
  scheduleTime: string;
  scheduleTimezone: string;
  now?: Date;
}

function tzWallClockMs(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (name: string): number =>
    Number(parts.find((p) => p.type === name)?.value ?? "0");
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
}

function computeNextFire(
  scheduleTime: string,
  tz: string,
  now: Date,
): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(scheduleTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const wallNowMs = tzWallClockMs(now, tz);
  const offsetMs = wallNowMs - now.getTime();

  const wallNow = new Date(wallNowMs);
  const wallTodayTarget = Date.UTC(
    wallNow.getUTCFullYear(),
    wallNow.getUTCMonth(),
    wallNow.getUTCDate(),
    hour,
    minute,
    0,
  );

  let next = wallTodayTarget - offsetMs;
  if (next <= now.getTime()) {
    next += 24 * 60 * 60 * 1000;
  }
  return new Date(next);
}

function formatRelative(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.round(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${String(days)}d ${String(hours)}h ${String(minutes)}m`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  return `${String(minutes)}m`;
}

export function ScheduleBanner({
  scheduleTime,
  scheduleTimezone,
  now = new Date(),
}: ScheduleBannerProps): ReactElement {
  const next = computeNextFire(scheduleTime, scheduleTimezone, now);
  const relative = next ? formatRelative(next, now) : "soon";
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900"
    >
      <Clock className="size-4 text-sky-700" />
      <span>
        Scheduled to run daily at {scheduleTime} {scheduleTimezone}. Next run in{" "}
        {relative}.
      </span>
    </div>
  );
}
