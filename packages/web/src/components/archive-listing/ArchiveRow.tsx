import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ArchiveListItem } from "@newsletter/shared";
import { parseLocalDate } from "./format.js";
import { highlightTerms as applyHighlightTerms } from "../../lib/highlightTerms.js";

export interface ArchiveRowProps {
  item: ArchiveListItem;
  issueNumber: number;
  featured: boolean;
  highlightTerms?: string[];
}

function applyHighlight(text: string | null | undefined, terms: string[] | undefined): ReactNode {
  if (text == null) return text;
  if (!terms || terms.length === 0) return text;
  return applyHighlightTerms(text, terms);
}

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function DateBlock({ runDate }: { runDate: string }): ReactElement {
  const date = parseLocalDate(runDate);
  const dow = dayFormatter.format(date).toUpperCase();
  const md = shortDateFormatter.format(date);
  const yr = date.getFullYear();
  return (
    <div className="flex flex-row md:flex-col items-baseline md:items-start gap-x-3 md:gap-y-2 leading-none font-serif">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#6b6557]">
        {dow}
      </span>
      <span className="text-2xl md:text-[28px] font-medium tracking-[-0.012em] text-[#14110d]">
        {md}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8472]">
        {yr}
      </span>
    </div>
  );
}

export function ArchiveRow({
  item,
  featured,
  highlightTerms,
}: ArchiveRowProps): ReactElement {
  const {
    runId,
    runDate,
    storyCount,
    topItems,
    leadSummary,
    digestHeadline,
    digestSummary,
  } = item;

  const hasStories = storyCount > 0;
  const showNoStories = !hasStories && topItems.length === 0;

  let headlineNode: ReactElement;
  if (showNoStories) {
    headlineNode = (
      <span className="font-mono text-sm text-[#8a8472]">No stories</span>
    );
  } else {
    const firstTopTitle = topItems.length > 0 ? topItems[0].title : "—";
    const headlineText = digestHeadline ?? firstTopTitle;
    headlineNode = (
      <h3
        className={`font-serif font-medium leading-[1.22] tracking-[-0.005em] text-[#14110d] ${featured ? "text-[26px] md:text-[28px]" : "text-[22px]"}`}
      >
        {applyHighlight(headlineText, highlightTerms)}
      </h3>
    );
  }

  const dek = digestSummary ?? (featured ? leadSummary : null);
  const showDek = typeof dek === "string" && dek.length > 0;

  const rowBody = (
    <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_92px] gap-3 md:gap-7 items-start md:items-center py-6 md:py-[26px] px-3 md:px-4 border-b border-[#e7e2d6] transition-colors duration-150 hover:bg-[rgba(20,17,13,0.025)] rounded-md">
      <div>
        <DateBlock runDate={runDate} />
      </div>
      <div className="min-w-0 flex flex-col gap-2">
        {headlineNode}
        {showDek ? (
          <p
            data-slot="dek"
            className="font-sans text-[14.5px] leading-[1.55] text-[#2a261f] line-clamp-2 m-0"
          >
            {applyHighlight(dek, highlightTerms)}
          </p>
        ) : null}
      </div>
      <div className="flex md:flex-col items-baseline md:items-end gap-3 md:gap-[14px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6b6557]">
        <span>
          {storyCount} {storyCount === 1 ? "story" : "stories"}
        </span>
        {hasStories ? (
          <span className="inline-flex items-center gap-[6px] border-b border-[#14110d] pb-[1px] font-mono text-[11px] tracking-[0.14em] text-[#14110d]">
            Read <span className="inline-block transition-transform">→</span>
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <li data-featured={featured ? "true" : undefined}>
      {hasStories ? (
        <Link
          to={`/archive/${runId}`}
          aria-label={`Read issue from ${runDate}`}
          className="block focus-visible:bg-[rgba(20,17,13,0.04)] focus-visible:outline-none"
        >
          {rowBody}
        </Link>
      ) : (
        rowBody
      )}
    </li>
  );
}
