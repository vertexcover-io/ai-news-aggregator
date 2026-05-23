import { type ReactElement, useState } from "react";
import type {
  ActualRankingItem,
  ExpectedRankingItem,
  Tier,
} from "@newsletter/shared/types/eval-ranking";
import { RankingFunnel } from "./CalendarReportComparison";

export interface ReportTabProps {
  actualRanking: readonly ActualRankingItem[];
  expectedRanking: readonly ExpectedRankingItem[] | undefined;
  scoreSheet: ReportScoreSheet | null;
  poolSize: number | undefined;
  costUsd: number;
}

export interface ReportScoreSheet {
  ndcgAt10: number | null;
  ndcgAt5: number | null;
  precisionAt10: number | null;
  mustIncludeRecall: number | null;
  rankOneIsMustInclude: boolean | null;
}

const TOP_N = 10;

function hostOf(url: string): string {
  if (url.length === 0) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatNum(n: number | null, digits = 3): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

interface TierChipProps {
  tier: Tier;
}

function TierChip({ tier }: TierChipProps): ReactElement {
  const classes: Record<Tier, string> = {
    must: "border-[#8c3a1e]/40 bg-[#fbf2ee] text-[#8c3a1e]",
    nice: "border-neutral-300 bg-neutral-50 text-neutral-700",
    drop: "border-neutral-200 bg-neutral-100 text-neutral-500",
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${classes[tier]}`}
    >
      {tier}
    </span>
  );
}

interface DeltaMarkerProps {
  expectedRank: number | null;
  actualRank: number;
}

function DeltaMarker({
  expectedRank,
  actualRank,
}: DeltaMarkerProps): ReactElement {
  if (expectedRank === null) {
    return (
      <span className="inline-flex items-center rounded-sm border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blue-700">
        NEW
      </span>
    );
  }
  const diff = expectedRank - actualRank;
  if (diff === 0) {
    return (
      <span className="font-mono text-[11px] text-neutral-400">—</span>
    );
  }
  if (diff > 0) {
    return (
      <span className="font-mono text-[11px] font-medium text-emerald-700">
        ↑{String(diff)}
      </span>
    );
  }
  return (
    <span className="font-mono text-[11px] font-medium text-[#8c3a1e]">
      ↓{String(-diff)}
    </span>
  );
}

interface ScoreStripProps {
  scoreSheet: ReportScoreSheet | null;
}

function ScoreStrip({ scoreSheet }: ScoreStripProps): ReactElement {
  if (scoreSheet === null) {
    return (
      <div
        data-testid="drawer-report-score-strip"
        className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 py-2 font-mono text-[11px] text-neutral-400"
      >
        Score sheet unavailable for this run.
      </div>
    );
  }
  return (
    <div
      data-testid="drawer-report-score-strip"
      className="sticky top-0 z-10 grid grid-cols-5 gap-3 border-b border-neutral-200 bg-white px-4 py-2 font-mono text-[11px]"
    >
      <ScoreCell label="nDCG@10" value={formatNum(scoreSheet.ndcgAt10)} highlight />
      <ScoreCell label="nDCG@5" value={formatNum(scoreSheet.ndcgAt5)} />
      <ScoreCell label="P@10" value={formatNum(scoreSheet.precisionAt10)} />
      <ScoreCell
        label="must-recall"
        value={formatNum(scoreSheet.mustIncludeRecall)}
      />
      <ScoreCell
        label="R1=must"
        value={
          scoreSheet.rankOneIsMustInclude === null
            ? "—"
            : scoreSheet.rankOneIsMustInclude
              ? "yes"
              : "no"
        }
      />
    </div>
  );
}

interface ScoreCellProps {
  label: string;
  value: string;
  highlight?: boolean;
}

function ScoreCell({
  label,
  value,
  highlight = false,
}: ScoreCellProps): ReactElement {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <span
        className={`tabular-nums ${
          highlight ? "text-base font-semibold text-neutral-900" : "text-neutral-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

interface MissingMustBannerProps {
  missing: readonly ExpectedRankingItem[];
}

function MissingMustBanner({
  missing,
}: MissingMustBannerProps): ReactElement | null {
  if (missing.length === 0) return null;
  const head = missing.slice(0, 3).map((m) => truncate(m.title, 40));
  const rest = missing.length - head.length;
  const tail = rest > 0 ? ` … +${String(rest)} more` : "";
  return (
    <div
      data-testid="drawer-report-missing-must-banner"
      className="mx-4 mt-3 rounded border border-[#8c3a1e]/30 bg-[#fbf2ee] p-3 font-mono text-[12px] text-[#5a2812]"
    >
      <div className="font-semibold uppercase tracking-wider text-[10px] text-[#8c3a1e]">
        {String(missing.length)} must-include item
        {missing.length === 1 ? "" : "s"} missing from top-{String(TOP_N)}
      </div>
      <p className="mt-1 text-neutral-700">{head.join(", ") + tail}</p>
    </div>
  );
}

interface ExpandableActualProps {
  item: ActualRankingItem;
  expectedRank: number | null;
  actualRank: number;
}

function ExpandableActual({
  item,
  expectedRank,
  actualRank,
}: ExpandableActualProps): ReactElement {
  const [open, setOpen] = useState(false);
  const isRankOne = actualRank === 1;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          setOpen((p) => !p);
        }}
        aria-expanded={open}
        className="flex items-baseline gap-2 text-left hover:underline"
      >
        <span
          className={`font-mono text-[11px] tabular-nums ${
            isRankOne ? "text-[#8c3a1e]" : "text-neutral-500"
          }`}
        >
          #{String(actualRank)}
        </span>
        <span
          className={`text-[13px] ${
            isRankOne ? "font-medium text-[#8c3a1e]" : "text-neutral-800"
          }`}
        >
          {truncate(item.title, 80)}
        </span>
      </button>
      <div className="flex items-center gap-2 pl-7 font-mono text-[10px] text-neutral-500">
        <span className="tabular-nums">score {item.score.toFixed(2)}</span>
        <DeltaMarker expectedRank={expectedRank} actualRank={actualRank} />
        {hostOf(item.url) !== "" ? (
          <span className="text-neutral-400">· {hostOf(item.url)}</span>
        ) : null}
      </div>
      {open ? (
        <div
          data-testid={`drawer-report-rationale-${String(item.rawItemId)}`}
          className="mt-1 ml-7 rounded border border-neutral-200 bg-neutral-50 p-2 text-[12px] text-neutral-800"
        >
          {item.rationale.length > 0 ? (
            <p className="italic text-neutral-700">{item.rationale}</p>
          ) : null}
          {item.summary.length > 0 ? (
            <p className="mt-2 text-neutral-800">{item.summary}</p>
          ) : null}
          {item.bullets.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-neutral-700">
              {item.bullets.map((b, idx) => (
                <li key={idx}>{b}</li>
              ))}
            </ul>
          ) : null}
          {item.bottomLine.length > 0 ? (
            <div className="mt-2 border-l-2 border-[#8c3a1e] pl-2 text-[12px] text-neutral-700">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#8c3a1e]">
                Bottom line
              </span>
              <p className="mt-0.5">{item.bottomLine}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReportTab({
  actualRanking,
  expectedRanking,
  scoreSheet,
  poolSize,
  costUsd,
}: ReportTabProps): ReactElement {
  const expectedByItem = new Map<number, ExpectedRankingItem>();
  for (const e of expectedRanking ?? []) {
    expectedByItem.set(e.rawItemId, e);
  }
  const actualByItem = new Map<number, ActualRankingItem & { rank: number }>();
  actualRanking.forEach((a, idx) => {
    actualByItem.set(a.rawItemId, { ...a, rank: idx + 1 });
  });

  // Items the ranker omitted from top-N entirely.
  const droppedFromTopN: ExpectedRankingItem[] = [];
  for (const e of expectedRanking ?? []) {
    if (!actualByItem.has(e.rawItemId)) droppedFromTopN.push(e);
  }
  const missingMust = droppedFromTopN.filter((e) => e.tier === "must");

  // Row union: every actual item gets a row; then any expected items the
  // ranker dropped get their own rows at the bottom (left-only).
  interface Row {
    rawItemId: number;
    expected: ExpectedRankingItem | null;
    actual: (ActualRankingItem & { rank: number }) | null;
  }
  const rows: Row[] = [];
  for (const a of actualByItem.values()) {
    rows.push({
      rawItemId: a.rawItemId,
      expected: expectedByItem.get(a.rawItemId) ?? null,
      actual: a,
    });
  }
  for (const e of droppedFromTopN) {
    rows.push({ rawItemId: e.rawItemId, expected: e, actual: null });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <RankingFunnel
          sent={poolSize}
          ranked={actualRanking.length}
          costUsd={costUsd}
          testIdPrefix="report-tab"
        />
      </div>
      <ScoreStrip scoreSheet={scoreSheet} />
      <MissingMustBanner missing={missingMust} />
      <div
        data-testid="report-tab-ranking-scroll"
        className="scrollbar-none overflow-auto"
      >
        <table
          data-testid="drawer-report-table"
          className="w-full table-fixed text-sm"
        >
          <thead>
            <tr className="border-b border-neutral-200 text-left font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="w-[50%] px-4 py-2">Expected (graded)</th>
              <th className="w-[50%] px-4 py-2">Actual (ranker)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={String(row.rawItemId)}
                data-testid={`drawer-report-row-${String(row.rawItemId)}`}
                className="border-b border-neutral-100 align-top hover:bg-neutral-50/50"
              >
                <td className="px-4 py-3">
                  {row.expected !== null ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-neutral-500">
                          #{String(row.expected.rank)}
                        </span>
                        <TierChip tier={row.expected.tier} />
                        <span className="text-[13px] text-neutral-800">
                          {truncate(row.expected.title, 70)}
                        </span>
                      </div>
                      {hostOf(row.expected.url) !== "" ? (
                        <span className="pl-7 font-mono text-[10px] text-neutral-400">
                          {hostOf(row.expected.url)}
                        </span>
                      ) : null}
                      {row.actual === null && row.expected.tier === "must" ? (
                        <span className="pl-7 font-mono text-[10px] font-medium text-[#8c3a1e]">
                          DROPPED from top-{String(TOP_N)}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="font-mono text-[11px] text-neutral-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.actual !== null ? (
                    <ExpandableActual
                      item={row.actual}
                      expectedRank={row.expected?.rank ?? null}
                      actualRank={row.actual.rank}
                    />
                  ) : (
                    <span className="font-mono text-[11px] text-neutral-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface EmptyReportProps {
  reason: "legacy" | "running" | "failed";
}

export function EmptyReport({ reason }: EmptyReportProps): ReactElement {
  const copy: Record<EmptyReportProps["reason"], string> = {
    legacy:
      "No report available — this run was created before reports were captured. Re-run the eval against this fixture to populate the comparison.",
    running: "Run still in progress…",
    failed:
      "This run failed before producing a ranking. See the error banner for details.",
  };
  return (
    <div
      data-testid="drawer-report-empty"
      className="flex h-full items-center justify-center px-6 py-10 font-mono text-[12px] text-neutral-500"
    >
      <p className="max-w-md text-center">{copy[reason]}</p>
    </div>
  );
}
