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

function DateBlock({
  runDate,
  issueNumber,
  featured,
}: {
  runDate: string;
  issueNumber: number;
  featured: boolean;
}): ReactElement {
  const date = parseLocalDate(runDate);
  const dayOfWeek = dayFormatter.format(date).toUpperCase();
  const shortDate = shortDateFormatter.format(date);
  const year = date.getFullYear();

  return (
    // Mobile: single inline row (flex-row, gap-x-2) above headline.
    // md+: stacked column (flex-col, gap-1) in the left rail.
    <div className="mb-2 md:mb-0 flex flex-wrap items-baseline gap-x-2 gap-y-0 md:flex-col md:gap-1">
      <span
        className={`font-mono text-[11px] uppercase tracking-[0.18em] ${featured ? "text-[#8C3A1E]" : "text-neutral-500"}`}
      >
        {dayOfWeek}
      </span>
      <span
        className={`font-serif font-medium leading-none text-neutral-900 md:block ${featured ? "text-2xl md:text-3xl" : "text-base md:text-xl"}`}
      >
        {shortDate}
      </span>
      <span className="font-mono text-[11px] text-neutral-500">
        {year} · N°{issueNumber}
      </span>
    </div>
  );
}

export function ArchiveRow({
  item,
  issueNumber,
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

  let headlineContent: ReactElement;
  if (showNoStories) {
    headlineContent = (
      <span className="font-mono text-sm text-neutral-400">No stories</span>
    );
  } else {
    const firstTopTitle = topItems.length > 0 ? topItems[0].title : "—";
    const headlineText = digestHeadline ?? firstTopTitle;
    headlineContent = (
      <h3
        className={`font-serif font-medium leading-tight ${featured ? "text-3xl" : "text-xl"}`}
      >
        {applyHighlight(headlineText, highlightTerms)}
      </h3>
    );
  }

  // Featured rows fall back to leadSummary (the rank-1 recap) when the digest
  // summary is missing — that was the pre-VER-96 dek behavior. Non-featured
  // rows never used leadSummary, so we only show a dek if digestSummary exists.
  const dek = digestSummary ?? (featured ? leadSummary : null);
  const showDek = typeof dek === "string" && dek.length > 0;

  const rowBody = (
    // Mobile: single-column grid (date eyebrow → content → meta).
    // md+: three-column grid [120px / 1fr / 120px] with date in left rail, meta in right rail.
    <div
      className={[
        "grid md:px-2",
        "grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)_120px]",
        "[grid-template-areas:'date''content''meta'] md:[grid-template-areas:'date_content_meta']",
        "gap-0 md:gap-12",
        featured ? "py-8 md:py-12" : "py-6 md:py-7",
      ].join(" ")}
    >
      <div className="[grid-area:date]">
        <DateBlock runDate={runDate} issueNumber={issueNumber} featured={featured} />
      </div>

      <div className="[grid-area:content] min-w-0 flex flex-col gap-4">
        {headlineContent}
        {showDek ? (
          <p className="font-sans text-[15px] leading-relaxed text-neutral-600 line-clamp-2">
            {applyHighlight(dek, highlightTerms)}
          </p>
        ) : null}
      </div>

      {/* Single meta block: flows after content column on mobile; placed in right rail on md+ via grid-area */}
      <div className="[grid-area:meta] flex md:flex-col items-end justify-end gap-1 mt-3 md:mt-0">
        <span className="font-mono text-xs text-neutral-500">
          {storyCount} {storyCount === 1 ? "story" : "stories"}
        </span>
        {hasStories ? (
          <span className="font-mono text-xs text-neutral-900">Read →</span>
        ) : null}
      </div>
    </div>
  );

  return (
    <li
      data-featured={featured ? "true" : undefined}
      className="border-b border-neutral-200"
    >
      {hasStories ? (
        <Link
          to={`/archive/${runId}`}
          className="block transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none"
        >
          {rowBody}
        </Link>
      ) : (
        rowBody
      )}
    </li>
  );
}

