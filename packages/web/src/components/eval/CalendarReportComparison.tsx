import { type ReactElement } from "react";
import type {
  CalendarRankingItem,
  CalendarRunReportEntry,
} from "@newsletter/shared/types/eval-ranking";
import { cn } from "@/lib/utils";

export type CalendarReportDoneEntry = Extract<
  CalendarRunReportEntry,
  { status: "done" }
>;

type ReportSide = "previous" | "draft";
type ReportDensity = "dialog" | "panel";

interface CalendarReportComparisonProps {
  report: CalendarReportDoneEntry;
  density?: ReportDensity;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shortHash(hash: string | null): string {
  return hash === null ? "--" : hash.slice(0, 8);
}

function rankingCountLabel(count: number): string {
  return count === 1 ? "1 item" : `${String(count)} items`;
}

interface RankingColumnProps {
  title: string;
  side: ReportSide;
  items: readonly CalendarRankingItem[];
  density: ReportDensity;
}

function RankingColumn({
  title,
  side,
  items,
  density,
}: RankingColumnProps): ReactElement {
  return (
    <section
      data-testid={`calendar-report-${side}-ranking`}
      className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
    >
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <div>
          <h3 className="font-mono text-[12px] font-semibold uppercase tracking-wider text-neutral-800">
            {title}
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            {rankingCountLabel(items.length)}
          </p>
        </div>
      </header>
      <div
        className={cn(
          "overflow-auto",
          density === "dialog" ? "max-h-[48vh]" : "max-h-[360px]",
        )}
      >
        {items.map((item) => {
          const host = hostOf(item.url);
          return (
            <article
              key={`${side}-${String(item.rawItemId)}`}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-100 px-4 py-4 last:border-none"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 font-mono text-[13px] font-semibold tabular-nums text-neutral-700">
                #{String(item.rank)}
              </div>
              <div className="min-w-0">
                <h4
                  data-testid={`calendar-report-title-${side}-${String(item.rank)}`}
                  className="break-words text-[15px] font-semibold leading-snug text-neutral-950"
                >
                  {item.title}
                </h4>
                <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] text-neutral-600">
                  <span className="rounded-sm bg-neutral-100 px-2 py-1">
                    {item.sourceType}
                  </span>
                  <span className="rounded-sm bg-neutral-100 px-2 py-1">
                    score {item.score.toFixed(2)}
                  </span>
                  {host !== "" ? (
                    <a
                      className="rounded-sm bg-neutral-100 px-2 py-1 text-neutral-700 underline-offset-2 hover:underline"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {host}
                    </a>
                  ) : null}
                </div>
                {item.rationale.length > 0 ? (
                  <p className="mt-3 text-sm leading-6 text-neutral-700">
                    {item.rationale}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface PromptPaneProps {
  label: string;
  hash: string | null;
  snapshot: string | null;
  side: "saved" | "draft";
  density: ReportDensity;
}

function PromptPane({
  label,
  hash,
  snapshot,
  side,
  density,
}: PromptPaneProps): ReactElement {
  return (
    <section
      data-testid={`calendar-report-${side}-prompt`}
      className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
    >
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <h3 className="font-mono text-[12px] font-semibold uppercase tracking-wider text-neutral-800">
          {label}
        </h3>
        <code className="rounded-sm bg-white px-2 py-1 font-mono text-[11px] text-neutral-500">
          {shortHash(hash)}
        </code>
      </header>
      <pre
        className={cn(
          "overflow-auto whitespace-pre-wrap bg-white px-4 py-3 font-mono text-[13px] leading-7 text-neutral-800",
          density === "dialog" ? "max-h-[260px]" : "max-h-[220px]",
        )}
      >
        {snapshot ?? "No saved prompt snapshot."}
      </pre>
    </section>
  );
}

export function CalendarReportComparison({
  report,
  density = "dialog",
}: CalendarReportComparisonProps): ReactElement {
  return (
    <div
      data-testid="calendar-report-layout"
      className={cn(
        "h-full min-h-0 overflow-auto",
        density === "dialog" ? "space-y-5 px-1 pb-1" : "space-y-4",
      )}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            Previous
          </p>
          <p className="mt-1 text-lg font-semibold text-neutral-950">
            {rankingCountLabel(report.previousRanking.length)}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            Draft
          </p>
          <p className="mt-1 text-lg font-semibold text-neutral-950">
            {rankingCountLabel(report.draftRanking.length)}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            Cost
          </p>
          <p className="mt-1 text-lg font-semibold text-neutral-950">
            ${report.cost.usd.toFixed(4)}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-2">
        <RankingColumn
          title="Previous ranking"
          side="previous"
          items={report.previousRanking}
          density={density}
        />
        <RankingColumn
          title="Draft ranking"
          side="draft"
          items={report.draftRanking}
          density={density}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PromptPane
          label="Saved prompt"
          side="saved"
          hash={report.promptDiff.savedPromptHash}
          snapshot={report.promptDiff.savedPromptSnapshot}
          density={density}
        />
        <PromptPane
          label="Draft prompt"
          side="draft"
          hash={report.promptDiff.draftPromptHash}
          snapshot={report.promptDiff.draftPromptSnapshot}
          density={density}
        />
      </div>
    </div>
  );
}
