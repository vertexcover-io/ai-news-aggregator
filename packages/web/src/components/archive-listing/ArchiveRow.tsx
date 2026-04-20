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
    <div className="flex flex-col gap-1">
      <span
        className={`font-mono text-xs font-medium tracking-widest ${featured ? "text-[#8C3A1E]" : "text-neutral-500"}`}
      >
        {dayOfWeek}
      </span>
      <span
        className={`font-serif font-medium leading-none text-neutral-900 ${featured ? "text-3xl" : "text-xl"}`}
      >
        {shortDate}
      </span>
      <span className="font-mono text-xs text-neutral-500">
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
    <div
      className={`grid grid-cols-[120px_minmax(0,1fr)_120px] gap-10 px-2 py-5${featured ? " py-8" : ""}`}
    >
      <DateBlock runDate={runDate} issueNumber={issueNumber} featured={featured} />

      <div className="flex flex-col gap-3">
        {headlineContent}
        {showDek ? (
          <p className="font-sans text-sm leading-relaxed text-neutral-600 line-clamp-2">
            {leadSummary}
          </p>
        ) : null}
        {hasTopItems ? (
          <ul className="flex flex-wrap gap-2">
            {topItems.map((t) => (
              <li key={t.id} title={t.title} className="font-mono text-xs rounded-full border border-neutral-200 px-2 py-0.5 text-neutral-700">
                {truncateChip(t.title)}
              </li>
            ))}
            {storyCount > topItems.length ? (
              <span className="font-mono text-xs text-neutral-500">
                {`+ ${String(storyCount - topItems.length)} more`}
              </span>
            ) : null}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-1">
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
