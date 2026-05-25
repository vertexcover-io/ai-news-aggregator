import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { ArchiveListItem, ArchiveTopItem } from "@newsletter/shared/types";

export interface TodaysIssueBlockProps {
  issue: ArchiveListItem;
}

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
});

function parseLocalDate(runDate: string): Date {
  return new Date(`${runDate}T00:00:00`);
}

const SOURCE_LABELS: Record<string, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  twitter: "X",
  rss: "RSS",
  github: "GitHub",
  blog: "Blog",
  newsletter: "Newsletter",
  web_search: "Web",
};

function sourceLabel(sourceType: ArchiveTopItem["sourceType"]): string {
  return SOURCE_LABELS[sourceType] ?? sourceType.toUpperCase();
}

export function TodaysIssueBlock({ issue }: TodaysIssueBlockProps): ReactElement {
  const date = parseLocalDate(issue.runDate);
  const dow = dayFormatter.format(date);
  const md = dateFormatter.format(date);

  const headline =
    issue.digestHeadline ?? (issue.topItems[0]?.title ?? "Today's issue");
  const dek = issue.digestSummary;

  const shown = issue.topItems.length;
  const moreCount = issue.storyCount - shown;

  return (
    <section data-section="todays-issue" className="py-14">
      <Link
        to={`/archive/${issue.runId}`}
        className="group block no-underline text-inherit"
      >
        {/* Eyebrow */}
        <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] mb-[24px]">
          Today&rsquo;s Issue{" "}
          <span className="text-[#14110d] opacity-40 mx-[6px]">·</span>
          {dow}, {md}
        </div>

        {/* Headline */}
        <h2
          className={[
            "font-serif font-medium leading-[1.04] tracking-[-0.016em]",
            "text-[clamp(34px,4.6vw,54px)]",
            "text-[#14110d] m-0 mb-[22px] max-w-[20ch]",
            "transition-colors duration-[250ms] ease-in-out",
            "group-hover:text-[#8c3a1e]",
          ].join(" ")}
        >
          {headline}
        </h2>

        {/* Dek — only when non-null */}
        {dek ? (
          <p className="font-serif italic font-normal text-[20px] leading-[1.5] text-[#6b6557] m-0 mb-[36px] max-w-[56ch]">
            {dek}
          </p>
        ) : null}

        {/* Running order — only when topItems non-empty */}
        {issue.topItems.length > 0 ? (
          <ol className="list-none m-0 mb-[28px] p-0 border-t border-[#e7e2d6]">
            {issue.topItems.map((item, i) => (
              <li
                key={item.id}
                className={[
                  "grid gap-x-[18px] gap-y-1 py-[14px] border-b border-[#e7e2d6]",
                  // Mobile: 2-track; source stacks beneath title
                  "grid-cols-[28px_1fr]",
                  // sm+: 3-track with source in right column (gap-y has no effect on single-row)
                  "sm:grid-cols-[28px_1fr_auto] sm:items-baseline",
                ].join(" ")}
              >
                <span className="font-mono text-[12px] text-[#8c3a1e] self-baseline">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-serif text-[21px] leading-[1.25] text-[#14110d]">
                  {item.title}
                </span>
                {/* Source: on mobile this sits in row 2 under the title */}
                <span
                  className={[
                    "font-mono text-[10px] tracking-[0.16em] uppercase text-[#6b6557] whitespace-nowrap",
                    // Mobile: start from column 2 (under title), not column 1
                    "col-start-2 sm:col-start-auto",
                  ].join(" ")}
                >
                  {sourceLabel(item.sourceType)}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {/* Read line */}
        <span className="inline-flex items-center gap-[10px] font-mono text-[11px] tracking-[0.2em] uppercase text-[#8c3a1e] font-medium">
          {moreCount > 0 ? `+ ${moreCount.toString()} more inside` : "Read today’s issue"}
          <span className="transition-transform duration-[250ms] ease-in-out group-hover:translate-x-[6px]">
            &rarr;
          </span>
        </span>
      </Link>
    </section>
  );
}
