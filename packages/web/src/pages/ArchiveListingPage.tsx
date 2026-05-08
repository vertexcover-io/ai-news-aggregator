import { useEffect, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { listArchives, searchArchives } from "../api/archives";
import { setMeta } from "../lib/meta";
import { MonthHeader } from "../components/archive-listing/MonthHeader";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { SearchBar } from "../components/archive-listing/SearchBar";
import { FilterTabs } from "../components/archive-listing/FilterTabs";
import { ResultMeta } from "../components/archive-listing/ResultMeta";
import { EmptyResults } from "../components/archive-listing/EmptyResults";
import { groupVisible } from "../components/archive-listing/format";
import { SubscribeInline } from "../components/archive-listing/SubscribeInline";
import { ScrollToTop } from "../components/ScrollToTop";

const TAGLINE = "AI news worth your morning.";

function VertexcoverPill(): ReactElement {
  return (
    <a
      href="https://vertexcover.io"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full border border-[#e7e2d6] bg-[#ffffff] px-[11px] py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6b6557] no-underline transition-colors duration-150 hover:border-[#d4ceba] hover:text-[#14110d]"
    >
      <span className="h-[6px] w-[6px] rounded-full bg-[#8c3a1e] shadow-[0_0_0_3px_rgba(140,58,30,0.14)]" />
      Made by Vertexcover Labs
    </a>
  );
}

function Hero(): ReactElement {
  return (
    <header className="text-center pt-6 pb-5">
      <VertexcoverPill />
      <h1 className="mt-[22px] mb-3 font-serif font-semibold leading-[1.02] tracking-[-0.012em] text-[#14110d] text-[46px] sm:text-[56px] md:text-[72px]">
        The Daily Read
      </h1>
      <p className="mt-0 mb-[26px] font-mono text-[11.5px] uppercase tracking-[0.22em] text-[#6b6557]">
        {TAGLINE}
      </p>
      <SubscribeInline variant="hero" />
    </header>
  );
}

function SkeletonRows(): ReactElement {
  return (
    <div className="flex flex-col gap-3 mt-12" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-md bg-[#f1ede2]" />
      ))}
    </div>
  );
}

function StateMessage({
  eyebrow,
  body,
}: {
  eyebrow?: string;
  body: string;
}): ReactElement {
  return (
    <div className="py-16 text-center">
      {eyebrow ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8c3a1e]">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-2 font-serif text-2xl text-[#2a261f]">{body}</h2>
    </div>
  );
}

export function ArchiveListingPage(): ReactElement {
  const [visibleCount, setVisibleCount] = useState(10);
  const [params] = useSearchParams();

  const q = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const isSearch = q.length > 0 || from.length > 0 || to.length > 0;

  useEffect(() => {
    document.title = "The Daily Read";
    setMeta("description", TAGLINE);
  }, []);

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

  const filterRow = (
    <section
      aria-label="Filter and search"
      className="mt-5 mb-2 mx-auto flex max-w-[760px] flex-col gap-[18px] border-t border-[#e7e2d6] pt-5"
    >
      <SearchBar />
      <FilterTabs />
    </section>
  );

  const shell = (content: ReactElement): ReactElement => (
    <main className="mx-auto max-w-[760px] px-5 sm:px-7 md:px-8 pt-8 sm:pt-11 pb-16 md:pb-24">
      <Hero />
      {filterRow}
      {content}
      <ScrollToTop />
    </main>
  );

  if (isLoading) return shell(<SkeletonRows />);

  if (isError) {
    return shell(
      <StateMessage eyebrow="Error" body="Couldn't load issues" />,
    );
  }

  if (!data || data.archives.length === 0) {
    if (isSearch && q.length > 0) return shell(<EmptyResults q={q} />);
    if (isSearch) {
      return shell(
        <div className="py-12 text-center">
          <p className="font-serif text-lg italic text-[#6b6557]">
            No issues match your filters.
          </p>
        </div>,
      );
    }
    return shell(
      <div className="py-16 text-center">
        <p className="font-serif text-xl italic text-[#2a261f]">
          No issues yet. Check back soon.
        </p>
      </div>,
    );
  }

  const highlightTermsList = q.length > 0 ? [q] : [];

  if (isSearch) {
    return shell(
      <>
        {q.length > 0 ? (
          <ResultMeta count={data.archives.length} q={q} />
        ) : null}
        <ul className="archive-list mt-6 list-none p-0 m-0">
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
        <section key={group.month}>
          <MonthHeader monthLabel={group.month} issueCount={group.items.length} />
          <ul className="archive-list list-none p-0 m-0">
            {group.items.map((item, localIdx) => {
              const globalIdx = group.startIndex + localIdx;
              return (
                <ArchiveRow
                  key={`${item.runId}-${String(globalIdx)}`}
                  item={item}
                  issueNumber={data.archives.length - globalIdx}
                  featured={
                    globalIdx === 0 &&
                    typeof item.leadSummary === "string" &&
                    item.leadSummary.length > 0
                  }
                />
              );
            })}
          </ul>
        </section>
      ))}
      {visibleCount < data.archives.length ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#2a261f] border border-[#e7e2d6] rounded-full px-5 py-2 min-h-[44px] hover:border-[#14110d] hover:text-[#14110d] transition-colors"
          >
            Load more
          </button>
        </div>
      ) : null}
    </>,
  );
}
