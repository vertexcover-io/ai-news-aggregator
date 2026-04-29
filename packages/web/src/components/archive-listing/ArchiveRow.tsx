import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { ArchiveListItem } from "@newsletter/shared";
import { parseLocalDate } from "./format.js";

export interface ArchiveRowProps {
  item: ArchiveListItem;
  issueNumber: number;
  featured: boolean;
}

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function truncateChip(title: string): string {
  if (title.length <= 28) return title;
  return title.slice(0, 27) + "\u2026";
}

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
}: ArchiveRowProps): ReactElement {
  const { runId, runDate, storyCount, topItems, leadSummary } = item;

  const hasStories = storyCount > 0;
  const hasTopItems = topItems.length > 0;

  let headlineContent: ReactElement;
  if (!hasStories && !hasTopItems) {
    headlineContent = (
      <span className="font-mono text-sm text-neutral-400">No stories</span>
    );
  } else if (!hasTopItems) {
    headlineContent = (
      <h3
        className={`font-serif font-medium leading-tight ${featured ? "text-3xl" : "text-xl"}`}
      >
        {"\u2014"}
      </h3>
    );
  } else {
    headlineContent = (
      <h3
        className={`font-serif font-medium leading-tight ${featured ? "text-3xl" : "text-xl"}`}
      >
        {topItems[0].title}
      </h3>
    );
  }

  const showDek = featured && typeof leadSummary === "string" && leadSummary.length > 0;

  const rowBody = (
    // Mobile: single-column grid (date eyebrow → content → meta inline under chips).
    // md+: three-column grid [120px / 1fr / 120px] with date in left rail, meta in right rail.
    // grid-template-areas lets the single meta <div> sit in column 3 on md+ without DOM duplication.
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
            {leadSummary}
          </p>
        ) : null}
        {hasTopItems ? (
          <ul className="flex flex-wrap gap-x-2 gap-y-1.5 pt-1">
            {topItems.map((t) => (
              <li key={t.id} title={t.title} className="inline-flex items-center font-mono text-[11px] rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
                {truncateChip(t.title)}
              </li>
            ))}
            {storyCount > topItems.length ? (
              <li className="inline-flex items-center font-mono text-[11px] py-1 self-center text-neutral-400">
                {`+ ${String(storyCount - topItems.length)} more`}
              </li>
            ) : null}
          </ul>
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
