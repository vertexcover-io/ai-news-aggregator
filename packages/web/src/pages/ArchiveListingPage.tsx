import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { ArchiveListItem } from "@newsletter/shared";
import { listArchives } from "../api/archives";
import { setMeta } from "../lib/meta";

const TAGLINE = "A hand-curated daily digest of what's actually moving in AI.";

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const rowDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function parseLocalDate(runDate: string): Date {
  return new Date(`${runDate}T00:00:00`);
}

function formatMonthLabel(runDate: string): string {
  return monthFormatter.format(parseLocalDate(runDate));
}

function formatRowDate(runDate: string): string {
  return rowDateFormatter.format(parseLocalDate(runDate));
}

interface MonthGroupData {
  month: string;
  items: ArchiveListItem[];
}

function groupByMonth(items: ArchiveListItem[]): MonthGroupData[] {
  const groups = new Map<string, ArchiveListItem[]>();
  for (const item of items) {
    const key = formatMonthLabel(item.runDate);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return Array.from(groups, ([month, groupItems]) => ({
    month,
    items: groupItems,
  }));
}

function Nav(): ReactElement {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-[720px] items-center justify-between px-4 py-4">
        <span className="text-sm font-semibold text-neutral-900">
          AI Newsletter
        </span>
        <a
          href="https://vertexcover.io"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded text-sm text-neutral-600 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          About
        </a>
      </div>
    </nav>
  );
}

function Hero(): ReactElement {
  return (
    <header className="pt-12 pb-10 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
        The Archive
      </h1>
      <p className="mt-3 text-sm text-neutral-600">{TAGLINE}</p>
    </header>
  );
}

function ArchiveRow({
  runId,
  runDate,
  storyCount,
}: ArchiveListItem): ReactElement {
  const label = `${formatRowDate(runDate)} — ${String(storyCount)} ${
    storyCount === 1 ? "story" : "stories"
  }`;
  return (
    <li>
      <Link
        to={`/archive/${runId}`}
        className="group flex items-center justify-between rounded-md border-b border-neutral-200 px-2 py-4 text-sm text-neutral-900 transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span>{label}</span>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </Link>
    </li>
  );
}

function MonthGroup({ month, items }: MonthGroupData): ReactElement {
  return (
    <section className="mb-10">
      <h2 className="mb-2 text-lg font-semibold text-neutral-900">{month}</h2>
      <ul className="flex flex-col">
        {items.map((item) => (
          <ArchiveRow key={item.runId} {...item} />
        ))}
      </ul>
    </section>
  );
}

function SkeletonRows(): ReactElement {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-md bg-neutral-100"
        />
      ))}
    </div>
  );
}

function EmptyState(): ReactElement {
  return (
    <p className="py-16 text-center text-sm text-neutral-600">
      No issues yet. Check back soon.
    </p>
  );
}

function Footer(): ReactElement {
  return (
    <footer className="mt-16 py-8 text-center text-xs text-neutral-500">
      Made by Vertexcover
    </footer>
  );
}

export function ArchiveListingPage(): ReactElement {
  useEffect(() => {
    document.title = "Newsletter archive";
    setMeta("description", TAGLINE);
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["archives", "list"],
    queryFn: listArchives,
  });

  const groups = data ? groupByMonth(data.archives) : [];

  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main className="mx-auto max-w-[720px] px-4">
        <Hero />
        {isLoading ? <SkeletonRows /> : null}
        {isError ? (
          <p
            role="status"
            aria-live="polite"
            className="py-16 text-center text-sm text-neutral-600"
          >
            Couldn't load issues
          </p>
        ) : null}
        {data?.archives.length === 0 ? <EmptyState /> : null}
        {data && data.archives.length > 0
          ? groups.map((group) => (
              <MonthGroup
                key={group.month}
                month={group.month}
                items={group.items}
              />
            ))
          : null}
      </main>
      <Footer />
    </div>
  );
}
