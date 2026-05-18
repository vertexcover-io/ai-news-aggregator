const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface PublishWindowInput {
  readonly timezone: string;
  readonly pipelineTime: string;
  readonly publishTime: string;
  readonly completedAt: Date;
}

function parseHHMM(hhmm: string): { readonly hour: number; readonly minute: number } {
  if (!HH_MM_RE.test(hhmm)) {
    throw new Error(`invalid HH:MM time: ${hhmm}`);
  }
  const [hour, minute] = hhmm.split(":").map(Number);
  return { hour, minute };
}

function minutesFromHHMM(hhmm: string): number {
  const { hour, minute } = parseHHMM(hhmm);
  return hour * 60 + minute;
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function partsInTimezone(formatter: Intl.DateTimeFormat, date: Date): DateParts {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function wallClockUtc(parts: DateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function dateFromTzParts(tz: string, targetParts: DateParts): Date {
  const formatter = formatterFor(tz);
  let candidateMs = wallClockUtc(targetParts);
  for (let i = 0; i < 4; i += 1) {
    const candidateParts = partsInTimezone(formatter, new Date(candidateMs));
    const deltaMs = wallClockUtc(targetParts) - wallClockUtc(candidateParts);
    if (deltaMs === 0) return new Date(candidateMs);
    candidateMs += deltaMs;
  }
  return new Date(candidateMs);
}

function addLocalDays(parts: DateParts, days: number): DateParts {
  const normalized = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute),
  );
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function dateAtTzTime(
  tz: string,
  hhmm: string,
  now: Date = new Date(),
): Date {
  const target = parseHHMM(hhmm);
  const formatter = formatterFor(tz);
  const currentParts = partsInTimezone(formatter, now);
  const targetParts: DateParts = {
    ...currentParts,
    hour: target.hour,
    minute: target.minute,
  };

  return dateFromTzParts(tz, targetParts);
}

export function publishDateForWindow(input: PublishWindowInput): Date {
  const pipelineMinutes = minutesFromHHMM(input.pipelineTime);
  const publishMinutes = minutesFromHHMM(input.publishTime);
  if (publishMinutes === pipelineMinutes) {
    throw new Error("publishTime must differ from pipelineTime");
  }

  const target = parseHHMM(input.publishTime);
  const formatter = formatterFor(input.timezone);
  const completedParts = partsInTimezone(formatter, input.completedAt);
  const targetParts: DateParts = {
    ...completedParts,
    hour: target.hour,
    minute: target.minute,
  };
  const scheduledParts =
    publishMinutes < pipelineMinutes ? addLocalDays(targetParts, 1) : targetParts;

  return dateFromTzParts(input.timezone, scheduledParts);
}
