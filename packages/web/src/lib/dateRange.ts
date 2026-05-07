import { format, isValid, parseISO } from "date-fns";

export interface DateRangeValue {
  from?: Date;
  to?: Date;
}

export type PresetName =
  | "last-7-days"
  | "last-30-days"
  | "last-90-days"
  | "this-year"
  | "all-time";

const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

function shortMonthDay(date: Date): string {
  return `${MONTH_LABELS[date.getMonth()]} ${String(date.getDate())}`;
}

export function formatRangeLabel(from: Date | undefined, to: Date | undefined): string {
  if (!from && !to) return "ALL TIME";
  if (from && !to) {
    return `${shortMonthDay(from)}, ${String(from.getFullYear())}`;
  }
  if (!from && to) {
    return `${shortMonthDay(to)}, ${String(to.getFullYear())}`;
  }
  if (from && to) {
    if (from.getFullYear() === to.getFullYear()) {
      return `${shortMonthDay(from)} – ${shortMonthDay(to)}, ${String(to.getFullYear())}`;
    }
    return `${shortMonthDay(from)}, ${String(from.getFullYear())} – ${shortMonthDay(to)}, ${String(to.getFullYear())}`;
  }
  return "ALL TIME";
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function presetRange(name: PresetName): DateRangeValue | undefined {
  if (name === "all-time") return undefined;
  const today = startOfDay(new Date());
  switch (name) {
    case "last-7-days": {
      const from = new Date(today);
      from.setDate(from.getDate() - 7);
      return { from, to: today };
    }
    case "last-30-days": {
      const from = new Date(today);
      from.setDate(from.getDate() - 30);
      return { from, to: today };
    }
    case "last-90-days": {
      const from = new Date(today);
      from.setDate(from.getDate() - 90);
      return { from, to: today };
    }
    case "this-year": {
      const from = new Date(today.getFullYear(), 0, 1);
      return { from, to: today };
    }
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function tryParseISODate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!ISO_DATE_RE.test(value)) return undefined;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : undefined;
}

export function parseRangeFromParams(params: { from?: string; to?: string }): DateRangeValue {
  return {
    from: tryParseISODate(params.from),
    to: tryParseISODate(params.to),
  };
}

export function serializeRangeToParams(range: DateRangeValue): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  if (range.from) out.from = format(range.from, "yyyy-MM-dd");
  if (range.to) out.to = format(range.to, "yyyy-MM-dd");
  return out;
}
