import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { ArchiveListItem } from "@newsletter/shared/types";

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

export function TodaysIssueBlock({ issue }: TodaysIssueBlockProps): ReactElement {
  const date = parseLocalDate(issue.runDate);
  const dow = dayFormatter.format(date).toUpperCase();
  const md = dateFormatter.format(date).toUpperCase();
  const headline =
    issue.digestHeadline ?? (issue.topItems[0]?.title ?? "Today’s issue");
  const dek = issue.digestSummary;

  return (
    <section
      data-section="todays-issue"
      className="py-14"
    >
      <div className="max-w-[760px]">
        <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#8c3a1e] mb-[22px]">
          {dow} · {md}
        </div>
        <h2 className="font-serif font-medium text-[clamp(32px,4vw,48px)] leading-[1.05] tracking-[-0.014em] text-[#14110d] m-0 mb-[22px]">
          {headline}
        </h2>
        {dek ? (
          <p className="font-serif italic font-normal text-[19px] leading-[1.55] text-[#6b6557] m-0 mb-8 max-w-[56ch]">
            {dek}
          </p>
        ) : null}
        <Link
          to={`/archive/${issue.runId}`}
          className="inline-flex items-center gap-2.5 font-mono uppercase tracking-[0.2em] text-[11px] font-medium text-[#8c3a1e] py-3 px-[18px] border-t border-b border-[#8c3a1e] hover:bg-[#8c3a1e] hover:text-[#fafaf7] transition-colors"
        >
          Read today <span className="font-mono tracking-normal">→</span>
        </Link>
      </div>
    </section>
  );
}
