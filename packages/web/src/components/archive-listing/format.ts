import type { ArchiveListItem } from "@newsletter/shared";

export function parseLocalDate(runDate: string): Date {
  return new Date(`${runDate}T00:00:00`);
}

export function runDateToMonthKey(runDate: string): string {
  const d = parseLocalDate(runDate);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(runDate: string): string {
  const d = parseLocalDate(runDate);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
}

export interface MonthChip {
  id: string;
  label: string;
  count: number;
}

export function buildMonthChips(items: ArchiveListItem[]): MonthChip[] {
  const buckets = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const id = runDateToMonthKey(item.runDate);
    const d = parseLocalDate(item.runDate);
    const label = new Intl.DateTimeFormat("en-US", { month: "short" }).format(d);
    const current = buckets.get(id) ?? { label, count: 0 };
    current.count += 1;
    buckets.set(id, current);
  }
  return Array.from(buckets, ([id, v]) => ({ id, ...v })).sort((a, b) =>
    b.id.localeCompare(a.id),
  );
}

export interface MonthGroup {
  month: string;
  items: ArchiveListItem[];
  startIndex: number;
}

export function groupVisible(visible: ArchiveListItem[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  let globalIndex = 0;
  for (const item of visible) {
    const key = runDateToMonthKey(item.runDate);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        month: formatMonthLabel(item.runDate),
        items: [item],
        startIndex: globalIndex,
      });
    }
    globalIndex++;
  }
  return Array.from(groups.values());
}
