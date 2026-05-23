import {
  formatDateInTimezone,
  formatDateTimeInTimezone,
  safeTimezone,
} from "@newsletter/shared/utils/timezone-date";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function configuredTimezone(
  timezone: string | null | undefined,
): string {
  return safeTimezone(timezone);
}

export function todayInTimezone(timezone: string | null | undefined): string {
  return formatDateInTimezone(new Date(), timezone);
}

export function addDaysToIsoDate(dateISO: string, days: number): string {
  const parsed = ISO_DATE_RE.exec(dateISO);
  if (parsed === null) return dateISO;
  const [, year, month, day] = parsed;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return dateISO;
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateTimeForTimezone(
  value: string | null,
  timezone: string | null | undefined,
): string {
  if (value === null) return "—";
  return formatDateTimeInTimezone(value, timezone);
}
