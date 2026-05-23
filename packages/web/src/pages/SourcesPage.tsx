import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  SOURCE_TYPE_ORDER,
  SOURCE_TYPE_SECTION_LABELS,
} from "@newsletter/shared/constants";
import type {
  SourcesSummaryResponse,
  SourcesSummaryRow,
  SourcesSummarySection,
} from "@newsletter/shared/types";
import { fetchSourcesSummary } from "../api/sources";
import { setMeta } from "../lib/meta";

type Status = SourcesSummaryRow["status"];

const STATUS_GLYPH: Record<Status, string> = {
  healthy: "●",
  idle: "○",
  failing: "✕",
};

const STATUS_LABEL: Record<Status, string> = {
  healthy: "Healthy",
  idle: "Idle",
  failing: "Failing",
};

const STATUS_COLOR: Record<Status, string> = {
  healthy: "text-[#14110d]",
  idle: "text-[#6b6557]",
  failing: "text-[#8c3a1e]",
};

function Masthead(): ReactElement {
  return (
    <header className="flex items-start justify-between gap-6 pt-7 pb-5">
      <div className="flex flex-col gap-1">
        <a
          href="/"
          className="font-mono text-[15px] font-medium uppercase tracking-[0.18em] text-[#14110d]"
        >
          AGENTLOOP
        </a>
        <span className="font-mono text-[11px] font-light tracking-[0.08em] text-[#6b6557]">
          A Vertexcover Labs publication
        </span>
      </div>
      <a
        href="/#subscribe"
        className="whitespace-nowrap pt-0.5 font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-[#14110d] hover:text-[#8c3a1e]"
      >
        Subscribe →
      </a>
    </header>
  );
}

function Nav(): ReactElement {
  const linkClass = (
    { isActive }: { isActive: boolean },
  ): string =>
    [
      "py-0.5 font-mono text-[11.5px] uppercase tracking-[0.18em]",
      isActive
        ? "border-b border-[#8c3a1e] text-[#8c3a1e]"
        : "text-[#6b6557] hover:text-[#14110d]",
    ].join(" ");

  const sep = (
    <span className="select-none px-3 text-[#e7e2d6]">·</span>
  );

  return (
    <>
      <hr className="border-t border-[#e7e2d6]" />
      <nav
        aria-label="Primary"
        className="flex flex-wrap py-3.5"
      >
        <NavLink to="/" end className={linkClass}>
          Today
        </NavLink>
        {sep}
        <NavLink to="/" className={linkClass}>
          Archive
        </NavLink>
        {sep}
        <NavLink to="/sources" className={linkClass}>
          Sources
        </NavLink>
      </nav>
      <hr className="border-t border-[#e7e2d6]" />
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function totalSourceCount(sections: SourcesSummarySection[]): number {
  return sections.reduce((acc, s) => acc + s.rows.length, 0);
}

function PageHeader({
  generatedAt,
  total,
}: {
  generatedAt: string;
  total: number;
}): ReactElement {
  return (
    <section className="pt-14 pb-10">
      <h1 className="m-0 mb-6 max-w-[14ch] font-serif text-[40px] font-medium leading-[1.05] tracking-[-0.015em] text-[#14110d] sm:text-[52px]">
        The reading list behind the newsletter.
      </h1>
      <p className="m-0 mb-7 max-w-[48ch] font-serif text-[19px] italic leading-[1.45] text-[#14110d]">
        AI sources, read daily. The list that produces the digest.
      </p>
      <p className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-[#6b6557]">
        Last updated: {formatDate(generatedAt)}
        <span className="px-2 text-[#e7e2d6]">·</span>
        {total} sources
      </p>
      <hr className="mt-9 border-t border-[#e7e2d6]" />
    </section>
  );
}

function dim(value: number): string {
  return value === 0 ? "text-[#6b6557]" : "text-[#14110d]";
}

function Row({ row }: { row: SourcesSummaryRow }): ReactElement {
  const nameEl =
    row.url !== null && row.url.length > 0 ? (
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-serif text-[17px] font-medium leading-[1.3] text-[#14110d] hover:text-[#8c3a1e]"
      >
        {row.displayName}
      </a>
    ) : (
      <span className="font-serif text-[17px] font-medium leading-[1.3] text-[#14110d]">
        {row.displayName}
      </span>
    );

  return (
    <div
      data-source-row="true"
      className="relative grid grid-cols-1 gap-2 border-t border-[#e7e2d6] py-3 sm:grid-cols-[1fr_64px_64px_64px_24px] sm:items-baseline sm:gap-4"
    >
      {nameEl}
      <span
        className={`hidden text-right font-mono text-[13px] sm:inline ${dim(row.todayCount)}`}
      >
        {row.todayCount}
      </span>
      <span
        className={`hidden text-right font-mono text-[13px] sm:inline ${dim(row.weekCount)}`}
      >
        {row.weekCount}
      </span>
      <span
        className={`hidden text-right font-mono text-[13px] sm:inline ${dim(row.inDigestCount)}`}
      >
        {row.inDigestCount}
      </span>
      <span
        aria-label={STATUS_LABEL[row.status]}
        className={`absolute right-4 top-3 font-mono text-[14px] sm:static sm:text-right ${STATUS_COLOR[row.status]}`}
      >
        {STATUS_GLYPH[row.status]}
      </span>
      <div className="flex flex-wrap gap-3 font-mono text-[12px] text-[#6b6557] sm:hidden">
        <span>
          Today: <span className={dim(row.todayCount)}>{row.todayCount}</span>
        </span>
        <span>
          Week: <span className={dim(row.weekCount)}>{row.weekCount}</span>
        </span>
        <span>
          Digest:{" "}
          <span className={dim(row.inDigestCount)}>{row.inDigestCount}</span>
        </span>
      </div>
    </div>
  );
}

function ColumnHeader(): ReactElement {
  return (
    <div className="hidden grid-cols-[1fr_64px_64px_64px_24px] items-baseline gap-4 pb-2 sm:grid">
      <span />
      <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6557]">
        Today
      </span>
      <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6557]">
        Week
      </span>
      <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6557]">
        Digest
      </span>
      <span />
    </div>
  );
}

function sortRows(rows: SourcesSummaryRow[]): SourcesSummaryRow[] {
  return [...rows].sort((a, b) => {
    if (b.todayCount !== a.todayCount) return b.todayCount - a.todayCount;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    });
  });
}

function Section({
  section,
  showColumnHeader,
}: {
  section: SourcesSummarySection;
  showColumnHeader: boolean;
}): ReactElement {
  const rows = sortRows(section.rows);
  return (
    <section className="pt-16">
      <h2 className="m-0 border-b border-[#8c3a1e] pb-2.5 font-mono text-[13.5px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
        {SOURCE_TYPE_SECTION_LABELS[section.sourceType]}
      </h2>
      <div className="mt-4">
        {showColumnHeader ? <ColumnHeader /> : null}
        {rows.map((row) => (
          <Row key={`${section.sourceType}:${row.identifier}`} row={row} />
        ))}
      </div>
    </section>
  );
}

function RankingPromptPanel({ prompt }: { prompt: string }): ReactElement {
  return (
    <section className="pt-16 pb-16">
      <h2 className="m-0 border-b border-[#8c3a1e] pb-2.5 font-mono text-[13.5px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
        Ranking Prompt
      </h2>
      <p className="mt-4 mb-5 font-serif text-[16px] italic leading-[1.55] text-[#6b6557]">
        This is the live system prompt used to rerank the day's stories. Edits
        in the admin settings take effect on the next run.
      </p>
      <pre
        className="m-0 whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-[13px] leading-[1.6] text-[#14110d]"
      >
        {prompt}
      </pre>
    </section>
  );
}

function orderSections(
  sections: SourcesSummarySection[],
): SourcesSummarySection[] {
  const bySourceType = new Map(sections.map((s) => [s.sourceType, s]));
  const ordered: SourcesSummarySection[] = [];
  for (const sourceType of SOURCE_TYPE_ORDER) {
    const s = bySourceType.get(sourceType);
    if (s && s.rows.length > 0) ordered.push(s);
  }
  return ordered;
}

function Shell({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="bg-[#fbfaf7] text-[#14110d]">
      <div className="mx-auto max-w-[820px] px-4 sm:px-8">
        <Masthead />
        <Nav />
        {children}
      </div>
    </div>
  );
}

export function SourcesPage(): ReactElement {
  useEffect(() => {
    document.title = "Sources · AgentLoop";
    setMeta(
      "description",
      "The reading list behind the AgentLoop newsletter.",
    );
  }, []);

  const { data, isLoading, isError } = useQuery<SourcesSummaryResponse>({
    queryKey: ["sources-summary"],
    queryFn: fetchSourcesSummary,
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="py-24 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Loading…
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <div className="py-24 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Could not load sources
        </div>
      </Shell>
    );
  }

  const sections = orderSections(data.sections);
  const total = totalSourceCount(sections);

  return (
    <Shell>
      <main className="pb-20">
        <PageHeader generatedAt={data.generatedAt} total={total} />
        {sections.map((section, idx) => (
          <Section
            key={section.sourceType}
            section={section}
            showColumnHeader={idx === 0}
          />
        ))}
        <RankingPromptPanel prompt={data.rankingPrompt} />
      </main>
    </Shell>
  );
}
