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

interface RankingFunnelProps {
  sent: number | undefined;
  ranked: number;
  costUsd: number;
  testIdPrefix: string;
}

export function RankingFunnel({
  sent,
  ranked,
  costUsd,
  testIdPrefix,
}: RankingFunnelProps): ReactElement {
  const notSurfaced = sent !== undefined && sent > ranked ? sent - ranked : 0;
  return (
    <div data-testid={`${testIdPrefix}-funnel`}>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {sent !== undefined ? (
          <div
            data-testid={`${testIdPrefix}-funnel-sent`}
            className="relative flex-1 border-r border-neutral-200 px-4 py-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-500">
              Sent for ranking
            </p>
            <p className="mt-2 font-serif text-3xl font-medium leading-none text-neutral-950">
              {String(sent)}{" "}
              <span className="text-xs font-normal text-neutral-500">items</span>
            </p>
            <span className="absolute -right-[11px] top-1/2 z-10 grid size-[22px] -translate-y-1/2 place-items-center rounded-full border border-neutral-200 bg-white font-mono text-[11px] text-neutral-400">
              →
            </span>
          </div>
        ) : null}
        <div
          data-testid={`${testIdPrefix}-funnel-ranked`}
          className="relative flex-1 border-r border-neutral-200 px-4 py-4"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-500">
            Ranked (top-N)
          </p>
          <p className="mt-2 font-serif text-3xl font-medium leading-none text-neutral-950">
            {String(ranked)}{" "}
            <span className="text-xs font-normal text-neutral-500">items</span>
          </p>
          <span className="absolute -right-[11px] top-1/2 z-10 grid size-[22px] -translate-y-1/2 place-items-center rounded-full border border-neutral-200 bg-white font-mono text-[11px] text-neutral-400">
            ·
          </span>
        </div>
        <div
          data-testid={`${testIdPrefix}-funnel-cost`}
          className="flex-1 px-4 py-4"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-500">
            Cost
          </p>
          <p className="mt-2 font-serif text-3xl font-medium leading-none text-[#8c3a1e]">
            ${costUsd.toFixed(4)}
          </p>
        </div>
      </div>
      {notSurfaced > 0 ? (
        <p
          data-testid={`${testIdPrefix}-funnel-note`}
          className="mt-2 px-0.5 font-serif text-xs italic text-neutral-500"
        >
          {String(notSurfaced)} items considered but not surfaced.
        </p>
      ) : null}
    </div>
  );
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
        data-testid={`calendar-report-${side}-scroll`}
        className={cn(
          "scrollbar-none overflow-auto",
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
        data-testid={`calendar-report-${side}-prompt-scroll`}
        className={cn(
          "scrollbar-none overflow-auto whitespace-pre-wrap bg-white px-4 py-3 font-mono text-[13px] leading-7 text-neutral-800",
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
      <RankingFunnel
        sent={report.poolSize}
        ranked={report.draftRanking.length}
        costUsd={report.cost.usd}
        testIdPrefix="calendar-report"
      />

      <div
        data-testid="calendar-report-columns"
        className="grid min-h-0 gap-4 lg:grid-cols-2"
      >
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
