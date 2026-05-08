import type { ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";

export type DateFilter = "all" | "month" | "30d" | "year";

interface Props {
  yearLabel?: number;
  /** Inject a clock for tests. Defaults to `new Date()`. */
  now?: Date;
}

interface TabSpec {
  key: DateFilter;
  label: (yr: number) => string;
}

const tabs: TabSpec[] = [
  { key: "all", label: () => "All time" },
  { key: "month", label: () => "This month" },
  { key: "30d", label: () => "Last 30 days" },
  { key: "year", label: (yr) => String(yr) },
];

function fmt(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function rangeForFilter(
  filter: DateFilter,
  now: Date,
): { from?: string; to?: string } {
  if (filter === "all") return {};
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (filter === "month") {
    return {
      from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: fmt(today),
    };
  }
  if (filter === "year") {
    return {
      from: fmt(new Date(today.getFullYear(), 0, 1)),
      to: fmt(today),
    };
  }
  // "30d"
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return { from: fmt(from), to: fmt(today) };
}

/** Given URL params, return which preset (if any) currently matches. */
export function filterFromRange(
  params: { from?: string; to?: string },
  now: Date,
): DateFilter {
  const f = params.from;
  const t = params.to;
  if (!f && !t) return "all";
  for (const filter of ["month", "30d", "year"] as const) {
    const want = rangeForFilter(filter, now);
    if (want.from === f && want.to === t) return filter;
  }
  // Custom range from somewhere else (e.g., a deep-link) — show no chip as active.
  return "all";
}

export function FilterTabs({ yearLabel, now }: Props): ReactElement {
  const [params, setParams] = useSearchParams();
  const today = now ?? new Date();
  const yr = yearLabel ?? today.getFullYear();
  const active = filterFromRange(
    {
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    },
    today,
  );

  const onPick = (next: DateFilter): void => {
    const nextParams = new URLSearchParams(params);
    const range = rangeForFilter(next, today);
    if (range.from !== undefined) nextParams.set("from", range.from);
    else nextParams.delete("from");
    if (range.to !== undefined) nextParams.set("to", range.to);
    else nextParams.delete("to");
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="flex justify-center -mx-2 sm:mx-0 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        role="group"
        aria-label="Date filter"
        className="inline-flex flex-none gap-1 rounded-full bg-[#f1ede2] p-1 mx-2 sm:mx-0"
      >
        {tabs.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                onPick(tab.key);
              }}
              className={[
                "whitespace-nowrap rounded-full px-[10px] sm:px-[14px] py-[7px] font-mono text-[10.5px] sm:text-[11px] uppercase tracking-[0.12em] sm:tracking-[0.14em] transition-colors duration-150",
                isActive
                  ? "bg-[#14110d] text-[#fbfaf7]"
                  : "bg-transparent text-[#2a261f] hover:bg-[rgba(20,17,13,0.06)]",
              ].join(" ")}
            >
              {tab.label(yr)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
