import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { SOURCE_TYPE_SECTION_LABELS } from "@newsletter/shared/constants";
import type {
  ConfiguredRow,
  ConfiguredSection,
  SourcesSummaryResponse,
} from "@newsletter/shared/types";
import { fetchSourcesSummary } from "../api/sources";
import { setMeta } from "../lib/meta";

function Masthead(): ReactElement {
  return (
    <header className="flex items-start justify-between gap-6 pt-6 pb-4">
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
  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    [
      "py-0.5 font-mono text-[11.5px] uppercase tracking-[0.18em]",
      isActive
        ? "border-b border-[#8c3a1e] text-[#8c3a1e]"
        : "text-[#6b6557] hover:text-[#14110d]",
    ].join(" ");
  const sep = <span className="select-none px-3 text-[#e7e2d6]">·</span>;
  return (
    <>
      <hr className="border-t border-[#e7e2d6]" />
      <nav aria-label="Primary" className="flex flex-wrap py-3">
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

function totalRows(sections: ConfiguredSection[]): number {
  return sections.reduce((acc, s) => acc + s.rows.length, 0);
}

function PageHead({
  sourceCount,
  sectionCount,
}: {
  sourceCount: number;
  sectionCount: number;
}): ReactElement {
  return (
    <section className="pt-8 pb-6">
      <h1 className="m-0 mb-3 max-w-[18ch] font-serif text-[34px] font-medium leading-[1.05] tracking-[-0.015em] text-[#14110d] sm:text-[42px]">
        The reading list behind the newsletter.
      </h1>
      <p className="m-0 mb-5 max-w-[52ch] font-serif text-[17px] italic leading-[1.4] text-[#14110d]">
        We read these every day. An LLM ranks the day&apos;s items on novelty,
        signal-vs-hype, and actionability. Picks go through human review
        before they hit your inbox.
      </p>
      <p className="flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6b6557]">
        <span>{sourceCount} sources</span>
        <span className="text-[#e7e2d6]">·</span>
        <span>
          {sectionCount} categor{sectionCount === 1 ? "y" : "ies"}
        </span>
        <span className="text-[#e7e2d6]">·</span>
        <span>Updated daily</span>
      </p>
    </section>
  );
}

function hostnameForDisplay(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Row({
  row,
  sourceType,
}: {
  row: ConfiguredRow;
  sourceType: ConfiguredSection["sourceType"];
}): ReactElement {
  const isQuery = sourceType === "web_search";
  const host = row.url !== null ? hostnameForDisplay(row.url) : null;

  const nameClass = `font-serif text-[16px] font-medium leading-[1.3] text-[#14110d] hover:text-[#8c3a1e] ${
    isQuery ? "italic" : ""
  }`;

  const nameEl =
    row.url !== null && row.url.length > 0 ? (
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        className={nameClass}
      >
        {row.displayName}
      </a>
    ) : (
      <span className={nameClass}>{row.displayName}</span>
    );

  return (
    <div
      data-source-row="true"
      className="grid grid-cols-[1fr_auto] items-baseline gap-4 py-2.5"
    >
      {nameEl}
      <span className="font-mono text-[11.5px] text-[#a39a86]">
        {isQuery ? "via Tavily" : host !== null ? `${host} ↗` : ""}
      </span>
    </div>
  );
}

function Section({ section }: { section: ConfiguredSection }): ReactElement {
  return (
    <section className="pt-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-[#8c3a1e] pb-1">
        <h2 className="m-0 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
          {SOURCE_TYPE_SECTION_LABELS[section.sourceType]}
        </h2>
        <span className="font-mono text-[10.5px] tabular-nums text-[#a39a86]">
          {section.rows.length}{" "}
          {section.sourceType === "web_search"
            ? section.rows.length === 1
              ? "query"
              : "queries"
            : section.rows.length === 1
              ? "source"
              : "sources"}
        </span>
      </div>
      <div className="mt-1 divide-y divide-[#efeadd]">
        {section.rows.map((r) => (
          <Row
            key={`${section.sourceType}:${r.identifier || r.displayName}`}
            row={r}
            sourceType={section.sourceType}
          />
        ))}
      </div>
    </section>
  );
}

function HowWePick(): ReactElement {
  return (
    <section className="mt-10 border-t border-[#e7e2d6] pt-6">
      <h2 className="m-0 mb-3 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
        How we pick
      </h2>
      <p className="m-0 max-w-[60ch] font-serif text-[16px] leading-[1.55] text-[#14110d]">
        Three axes — Novelty, Signal-vs-hype, Actionability — applied to every
        item the collectors return. A human reviews the top twelve before
        publish.
      </p>
    </section>
  );
}

function Shell({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="mx-auto max-w-[820px] px-4 sm:px-8">
      <Masthead />
      <Nav />
      {children}
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
    queryFn: () => fetchSourcesSummary(),
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="py-16 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Loading…
        </div>
      </Shell>
    );
  }
  if (isError || !data) {
    return (
      <Shell>
        <div className="py-16 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Could not load sources
        </div>
      </Shell>
    );
  }

  const sections = data.configured;
  return (
    <Shell>
      <main className="pb-12">
        <PageHead
          sourceCount={totalRows(sections)}
          sectionCount={sections.length}
        />
        {sections.map((s) => (
          <Section key={s.sourceType} section={s} />
        ))}
        <HowWePick />
      </main>
    </Shell>
  );
}
