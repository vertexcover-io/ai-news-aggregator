import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ConfiguredSection,
  SourcesSummaryResponse,
} from "@newsletter/shared/types";
import { fetchSourcesSummary } from "../api/sources";
import { setMeta } from "../lib/meta";
import { useTenantBranding } from "../context/TenantBrandingContext";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";
import {
  SourceCatalog,
  type SourceCatalogSection,
} from "../components/sources/SourceCatalog";
import { sourceTypeLabel } from "../components/sources/sourceCatalogUtils";

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

function rowCountLabel(section: ConfiguredSection): string {
  const noun =
    section.sourceType === "web_search"
      ? section.rows.length === 1
        ? "query"
        : "queries"
      : section.rows.length === 1
        ? "source"
        : "sources";
  return `${String(section.rows.length)} ${noun}`;
}

function configuredToCatalogSection(section: ConfiguredSection): SourceCatalogSection {
  return {
    sourceType: section.sourceType,
    label: sourceTypeLabel(section.sourceType),
    countLabel: rowCountLabel(section),
    rows: section.rows.map((row) => {
      const host = row.url !== null ? hostnameForDisplay(row.url) : null;
      return {
        id: `${section.sourceType}:${row.identifier || row.displayName}`,
        displayName: row.displayName,
        url: row.url,
        meta:
          section.sourceType === "web_search"
            ? "via Tavily"
            : host !== null
              ? `${host} ↗`
              : "",
      };
    }),
  };
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
    <main className="max-w-[760px] mx-auto">
      {children}
      <InlineSubscribeCard />
    </main>
  );
}

export function SourcesPage(): ReactElement {
  const branding = useTenantBranding();

  useEffect(() => {
    document.title = `Sources · ${branding.name}`;
    setMeta(
      "description",
      `The reading list behind the ${branding.name} newsletter.`,
    );
  }, [branding.name]);

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
        <SourceCatalog
          sections={sections.map(configuredToCatalogSection)}
          variant="page"
        />
        <HowWePick />
      </main>
    </Shell>
  );
}
