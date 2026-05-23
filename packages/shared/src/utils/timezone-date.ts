const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function partsInTimezone(date: Date, timezone: string): DateParts {
  const parts = Object.fromEntries(
    formatterFor(timezone).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function wallClockUtc(parts: DateParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function nextIsoDate(dateISO: string): string | null {
  const parsed = ISO_DATE_RE.exec(dateISO);
  if (parsed === null) return null;
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function safeTimezone(timezone: string | null | undefined): string {
  if (timezone === null || timezone === undefined || timezone.trim() === "") {
    return "UTC";
  }
  try {
    formatterFor(timezone).format(new Date(0));
    return timezone;
  } catch {
    return "UTC";
  }
}

export function formatDateInTimezone(
  value: Date | string,
  timezone: string | null | undefined,
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = partsInTimezone(date, safeTimezone(timezone));
  return `${String(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function formatDateTimeInTimezone(
  value: Date | string,
  timezone: string | null | undefined,
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function startOfDateInTimezone(
  dateISO: string,
  timezone: string | null | undefined,
): Date | null {
  const parsed = ISO_DATE_RE.exec(dateISO);
  if (parsed === null) return null;
  const [, year, month, day] = parsed;
  const targetParts: DateParts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const tz = safeTimezone(timezone);
  let candidateMs = wallClockUtc(targetParts);
  for (let i = 0; i < 4; i += 1) {
    const candidateParts = partsInTimezone(new Date(candidateMs), tz);
    const deltaMs = wallClockUtc(targetParts) - wallClockUtc(candidateParts);
    if (deltaMs === 0) return new Date(candidateMs);
    candidateMs += deltaMs;
  }
  return new Date(candidateMs);
}

export function endOfDateInTimezone(
  dateISO: string,
  timezone: string | null | undefined,
): Date | null {
  const next = nextIsoDate(dateISO);
  if (next === null) return null;
  const nextStart = startOfDateInTimezone(next, timezone);
  if (nextStart === null) return null;
  return new Date(nextStart.getTime() - 1);
}
