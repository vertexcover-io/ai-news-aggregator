import { useEffect, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { listArchives, searchArchives } from "../api/archives";
import { setMeta } from "../lib/meta";
import { MonthHeader } from "../components/archive-listing/MonthHeader";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { SearchBar } from "../components/archive-listing/SearchBar";
import { ResultMeta } from "../components/archive-listing/ResultMeta";
import { EmptyResults } from "../components/archive-listing/EmptyResults";
import { DateRangeChip } from "../components/archive-listing/DateRangeChip";
import { groupVisible } from "../components/archive-listing/format";
import {
  formatRangeLabel,
  parseRangeFromParams,
  serializeRangeToParams,
  type DateRangeValue,
} from "../lib/dateRange";
import { SubscribeWidget } from "../components/SubscribeWidget";

const TAGLINE = "AI news worth your morning.";

function Hero(): ReactElement {
  return (
    <header className="pt-12 pb-8 text-center">
      <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight text-neutral-900">The Daily Read</h1>
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
  const [visibleCount, setVisibleCount] = useState(10);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const isSearch = q.length > 0 || from.length > 0 || to.length > 0;
  const range = parseRangeFromParams({
    from: from.length > 0 ? from : undefined,
    to: to.length > 0 ? to : undefined,
  });
  const hasRange = Boolean(range.from ?? range.to);
  const rangeLabel = hasRange ? formatRangeLabel(range.from, range.to) : undefined;

  const handleRangeChange = (next: DateRangeValue | undefined): void => {
    const nextParams = new URLSearchParams(params);
    if (!next || (!next.from && !next.to)) {
      nextParams.delete("from");
      nextParams.delete("to");
    } else {
      const serialized = serializeRangeToParams(next);
      if (serialized.from) nextParams.set("from", serialized.from);
      else nextParams.delete("from");
      if (serialized.to) nextParams.set("to", serialized.to);
      else nextParams.delete("to");
    }
    setParams(nextParams, { replace: true });
  };

  useEffect(() => { document.title = "Sieve — The Daily Read"; setMeta("description", TAGLINE); }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: isSearch ? ["archives", "search", q, from, to] : ["archives", "list"],
    queryFn: isSearch
      ? (): ReturnType<typeof searchArchives> =>
          searchArchives({
            q: q.length > 0 ? q : undefined,
            from: from.length > 0 ? from : undefined,
            to: to.length > 0 ? to : undefined,
          })
      : listArchives,
  });

  const shell = (content: ReactElement): ReactElement => (
    <main className="mx-auto max-w-[860px] px-4 sm:px-6">
      <Hero />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar />
        </div>
        <DateRangeChip value={hasRange ? range : undefined} onChange={handleRangeChange} />
      </div>
      {content}
    </main>
  );

  if (isLoading) return shell(<SkeletonRows />);

  if (isError) return shell(
    <div className="py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">Error</p>
      <h2 className="mt-2 font-serif text-2xl text-neutral-900">Couldn't load issues</h2>
    </div>
  );

  if (!data || data.archives.length === 0) {
    if (isSearch && q.length > 0) return shell(<EmptyResults q={q} />);
    return shell(
      <div className="py-16 text-center">
        <p className="font-serif text-xl text-neutral-600">No issues yet. Check back soon.</p>
      </div>
    );
  }

  const highlightTermsList = q.length > 0 ? [q] : [];

  if (isSearch) {
    return shell(
      <>
        {q.length > 0 ? (
          <ResultMeta count={data.archives.length} q={q} rangeLabel={rangeLabel} />
        ) : null}
        <ul className="archive-list mt-6">
          {data.archives.map((item, idx) => (
            <ArchiveRow
              key={`${item.runId}-${String(idx)}`}
              item={item}
              issueNumber={data.archives.length - idx}
              featured={false}
              highlightTerms={highlightTermsList}
            />
          ))}
        </ul>
      </>,
    );
  }

  const visible = data.archives.slice(0, Math.min(visibleCount, data.archives.length));
  const groups = groupVisible(visible);

  const handleLoadMore = (): void => {
    setVisibleCount((c) => Math.min(c + 10, data.archives.length));
  };

  return shell(
    <>
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
      {visibleCount < data.archives.length ? (
        <div className="mt-8 flex justify-center">
          <button type="button" onClick={handleLoadMore} className="font-mono text-sm text-neutral-600 hover:text-neutral-900 border border-neutral-300 rounded px-4 min-h-[44px]">
            Load more
          </button>
        </div>
      ) : null}
      <div id="subscribe" className="mt-12 border-t border-neutral-200 pt-8 scroll-mt-24">
        <SubscribeWidget className="mx-auto max-w-[480px]" />
      </div>
    </>
  );
}
