import { useEffect, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { listArchives } from "../api/archives";
import { setMeta } from "../lib/meta";
import { FilterChip } from "../components/archive-listing/FilterChip";
import { MonthHeader } from "../components/archive-listing/MonthHeader";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { buildMonthChips, groupVisible, runDateToMonthKey } from "../components/archive-listing/format";

const TAGLINE = "A hand-curated daily digest of what's actually moving in AI.";

function Hero(): ReactElement {
  return (
    <header className="pt-12 pb-8 text-center">
      <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight text-neutral-900">The Archive</h1>
      <p className="mt-3 font-mono text-xs text-neutral-500 uppercase tracking-widest">{TAGLINE}</p>
    </header>
  );
}

function SkeletonRows(): ReactElement {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-md bg-neutral-100" />)}
    </div>
  );
}

export function ArchiveListingPage(): ReactElement {
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [visibleState, setVisibleState] = useState<{ month: string | null; count: number }>({ month: null, count: 10 });
  const visibleCount = visibleState.month === activeMonth ? visibleState.count : 10;

  useEffect(() => { document.title = "Newsletter archive"; setMeta("description", TAGLINE); }, []);

  const { data, isLoading, isError } = useQuery({ queryKey: ["archives", "list"], queryFn: listArchives });

  const shell = (content: ReactElement): ReactElement => (
    <main className="mx-auto max-w-[860px] px-4 sm:px-6"><Hero />{content}</main>
  );

  if (isLoading) return shell(<SkeletonRows />);

  if (isError) return shell(
    <div className="py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">Error</p>
      <h2 className="mt-2 font-serif text-2xl text-neutral-900">Couldn't load issues</h2>
    </div>
  );

  if (!data || data.archives.length === 0) return shell(
    <div className="py-16 text-center">
      <p className="font-serif text-xl text-neutral-600">No issues yet. Check back soon.</p>
    </div>
  );

  const monthChips = buildMonthChips(data.archives);
  const filtered = activeMonth === null ? data.archives : data.archives.filter((a) => runDateToMonthKey(a.runDate) === activeMonth);
  const visible = filtered.slice(0, Math.min(visibleCount, filtered.length));
  const groups = groupVisible(visible);

  const handleChipClick = (id: string): void => {
    if (id === "all") setActiveMonth(null);
    else setActiveMonth((prev) => (prev === id ? null : id));
  };

  const handleLoadMore = (): void => {
    setVisibleState({ month: activeMonth, count: Math.min(visibleCount + 10, filtered.length) });
  };

  return shell(
    <>
      <div className="flex flex-wrap gap-2 pb-6 border-b border-neutral-100">
        <FilterChip id="all" label="All" count={data.archives.length} active={activeMonth === null} onClick={handleChipClick} />
        {monthChips.map((chip) => (
          <FilterChip key={chip.id} id={chip.id} label={chip.label} count={chip.count} active={activeMonth === chip.id} onClick={handleChipClick} />
        ))}
      </div>
      {groups.map((group) => (
        <section key={group.month} className="mt-8">
          <MonthHeader monthLabel={group.month} issueCount={group.items.length} />
          <ul className="archive-list">
            {group.items.map((item, localIdx) => {
              const globalIdx = group.startIndex + localIdx;
              return (
                <ArchiveRow
                  key={item.runId}
                  item={item}
                  issueNumber={data.archives.length - globalIdx}
                  featured={globalIdx === 0 && typeof item.leadSummary === "string" && item.leadSummary.length > 0}
                />
              );
            })}
          </ul>
        </section>
      ))}
      {visibleCount < filtered.length ? (
        <div className="mt-8 flex justify-center">
          <button type="button" onClick={handleLoadMore} className="font-mono text-sm text-neutral-600 hover:text-neutral-900 border border-neutral-300 rounded px-4 min-h-[44px]">
            Load more
          </button>
        </div>
      ) : null}
    </>
  );
}
