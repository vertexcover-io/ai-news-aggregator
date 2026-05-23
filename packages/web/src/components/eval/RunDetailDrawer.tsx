import { type ReactElement, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ActualRankingItem,
  CalendarRankingItem,
  CalendarRunReportEntry,
  EvalRun,
  ExpectedRankingItem,
} from "@newsletter/shared/types/eval-ranking";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getEvalRun, EvalApiError } from "../../api/eval";
import { EmptyReport, ReportTab, type ReportScoreSheet } from "./ReportTab";
import { CalendarReportComparison } from "./CalendarReportComparison";

type DrawerTab = "prompt-cost" | "report";

interface PerFixtureEntry {
  fixtureId?: unknown;
  status?: unknown;
  score?: unknown;
  cost?: unknown;
  error?: unknown;
  actualRanking?: unknown;
  expectedRanking?: unknown;
}

function pickArray<T>(value: unknown, guard: (v: unknown) => v is T): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const v of value) {
    if (!guard(v)) return null;
    out.push(v);
  }
  return out;
}

function isActualRankingItem(v: unknown): v is ActualRankingItem {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.rawItemId === "number" &&
    typeof o.url === "string" &&
    typeof o.title === "string" &&
    typeof o.score === "number" &&
    typeof o.rationale === "string" &&
    typeof o.summary === "string" &&
    Array.isArray(o.bullets) &&
    typeof o.bottomLine === "string"
  );
}

function isExpectedRankingItem(v: unknown): v is ExpectedRankingItem {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const tierOk =
    o.tier === "must" || o.tier === "nice" || o.tier === "drop";
  return (
    typeof o.rawItemId === "number" &&
    typeof o.url === "string" &&
    typeof o.title === "string" &&
    tierOk &&
    typeof o.rank === "number"
  );
}

function isCalendarRankingItem(v: unknown): v is CalendarRankingItem {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.rank === "number" &&
    typeof o.rawItemId === "number" &&
    typeof o.title === "string" &&
    typeof o.url === "string" &&
    typeof o.sourceType === "string" &&
    typeof o.score === "number" &&
    typeof o.rationale === "string" &&
    typeof o.summary === "string" &&
    Array.isArray(o.bullets) &&
    typeof o.bottomLine === "string"
  );
}

function isCalendarRunReportEntry(v: unknown): v is CalendarRunReportEntry {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.runId !== "string") return false;
  if (o.status === "error") return typeof o.error === "string";
  if (o.status !== "done") return false;
  const previous = pickArray(o.previousRanking, isCalendarRankingItem);
  const draft = pickArray(o.draftRanking, isCalendarRankingItem);
  const promptDiff = pickObject(o.promptDiff);
  const cost = pickObject(o.cost);
  return previous !== null && draft !== null && promptDiff !== null && cost !== null;
}

interface DrawerReportData {
  actual: ActualRankingItem[];
  expected: ExpectedRankingItem[] | undefined;
  scoreSheet: ReportScoreSheet | null;
}

function extractReportData(run: EvalRun): DrawerReportData | null {
  if (run.mode !== "scored") return null;
  const sb = run.scoreBreakdown;
  if (sb === null || typeof sb !== "object") return null;
  const perFixture = (sb as { perFixture?: unknown }).perFixture;
  if (!Array.isArray(perFixture) || perFixture.length === 0) return null;
  const first = perFixture[0] as PerFixtureEntry;
  const actual = pickArray(first.actualRanking, isActualRankingItem);
  if (actual === null) return null;
  const expected = pickArray(first.expectedRanking, isExpectedRankingItem);
  const score =
    first.score !== null && typeof first.score === "object"
      ? (first.score as Record<string, unknown>)
      : null;
  const scoreSheet: ReportScoreSheet | null =
    score === null
      ? null
      : {
          ndcgAt10:
            typeof score.ndcgAt10 === "number" ? score.ndcgAt10 : null,
          ndcgAt5: typeof score.ndcgAt5 === "number" ? score.ndcgAt5 : null,
          precisionAt10:
            typeof score.precisionAt10 === "number"
              ? score.precisionAt10
              : null,
          mustIncludeRecall:
            typeof score.mustIncludeRecall === "number"
              ? score.mustIncludeRecall
              : null,
          rankOneIsMustInclude:
            typeof score.rankOneIsMustInclude === "boolean"
              ? score.rankOneIsMustInclude
              : null,
        };
  return {
    actual,
    expected: expected ?? undefined,
    scoreSheet,
  };
}

function extractCalendarReports(run: EvalRun): CalendarRunReportEntry[] {
  if (run.mode !== "ab") return [];
  const sb = pickObject(run.scoreBreakdown);
  if (sb === null) return [];
  const calendarRuns = pickArray(sb.calendarRuns, isCalendarRunReportEntry);
  return calendarRuns ?? [];
}

function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

export interface RunDetailDrawerProps {
  runId: string | null;
  onClose: () => void;
}

function formatTimestamp(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortHash(hash: string | null): string {
  if (hash === null) return "—";
  return hash.slice(0, 8);
}

function modeLabel(mode: EvalRun["mode"]): string {
  return mode === "scored" ? "Mode A" : "Mode B";
}

interface StatusChipProps {
  status: EvalRun["status"];
}

function StatusChip({ status }: StatusChipProps): ReactElement {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-emerald-700">
        <span className="inline-block size-1.5 rounded-full bg-emerald-600" />
        Done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-red-700">
        <span className="inline-block size-1.5 rounded-full bg-red-600" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-blue-700">
      <span className="inline-block size-1.5 rounded-full bg-blue-600" />
      Running
    </span>
  );
}

interface SnapshotPaneProps {
  hash: string;
  snapshot: string;
}

function SnapshotPane({ hash, snapshot }: SnapshotPaneProps): ReactElement {
  const lines = snapshot.split("\n");
  const charCount = snapshot.length;
  return (
    <div className="flex flex-col" data-testid="drawer-snapshot-pane">
      <header className="flex items-baseline justify-between border-b border-neutral-200 px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-700">
          Prompt snapshot
        </span>
        <span className="font-mono text-[11px] text-neutral-400">
          hash ·{" "}
          <span className="text-neutral-700">{shortHash(hash)}</span> ·{" "}
          {String(lines.length)} lines · {String(charCount)} chars
        </span>
      </header>
      <div className="max-h-[420px] overflow-auto bg-[#FAFAF7]">
        <div
          data-testid="drawer-snapshot-body"
          className="grid font-mono text-[12px] leading-relaxed"
          style={{ gridTemplateColumns: "40px 1fr" }}
        >
          {lines.map((line, idx) => (
            <div key={idx} className="contents">
              <span className="border-r border-neutral-200 pr-2 text-right text-neutral-400 select-none">
                {String(idx + 1)}
              </span>
              <pre className="overflow-x-auto px-3 whitespace-pre text-neutral-800">
                {line === "" ? " " : line}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface BreakdownRow {
  label: string;
  value: string;
  total?: boolean;
  sub?: boolean;
  muted?: boolean;
}

interface BreakdownTableProps {
  rows: readonly BreakdownRow[];
  testId?: string;
}

function BreakdownTable({ rows, testId }: BreakdownTableProps): ReactElement {
  return (
    <div className="border-b border-neutral-200" data-testid={testId}>
      {rows.map((r, idx) => (
        <div
          key={idx}
          className={`flex items-center justify-between px-4 py-2 font-mono text-[12px] ${
            r.total
              ? "border-t border-neutral-200 font-semibold text-neutral-900"
              : r.sub
                ? "pl-8 text-[11px] text-neutral-500"
                : "text-neutral-700"
          }`}
        >
          <span>{r.label}</span>
          <span className={r.muted ? "text-neutral-400" : "tabular-nums"}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatNum(n: unknown, digits = 3): string {
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(digits);
  return "—";
}

function formatTokens(n: unknown): string {
  if (typeof n === "number" && Number.isFinite(n))
    return `${n.toLocaleString()} tok`;
  return "—";
}

/**
 * Score breakdown shape we read (from packages/api/src/routes/admin-eval.ts):
 *   Mode A: { aggregate: { meanNdcgAt10 }, perFixture: [{ fixtureId, status, score: { ndcgAt10, ndcgAt5, precisionAt10, mustIncludeRecall, rankOneIsMustInclude } | null, cost, error }, ...] }
 *   Mode B: { saved: RankedItemRef[], draft: RankedItemRef[] }
 *
 * Cost breakdown shape:
 *   Mode A: { totalUsd, perFixture: [{ fixtureId, cost: { usd, tokensIn, tokensOut, cacheHit, promptHash } }, ...] }
 *   Mode B: { totalUsd, saved: RunEvalCost, draft: RunEvalCost }
 */

interface FixtureEntry {
  fixtureId?: unknown;
  status?: unknown;
  score?: unknown;
  cost?: unknown;
  error?: unknown;
}

function pickObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildScoreRows(run: EvalRun): readonly BreakdownRow[] {
  const sb = pickObject(run.scoreBreakdown);
  if (sb === null) return [];

  if (run.mode === "scored") {
    const aggregate = pickObject(sb.aggregate);
    const perFixture = Array.isArray(sb.perFixture)
      ? (sb.perFixture as FixtureEntry[])
      : [];
    // Single-fixture runs are the common case: render its per-fixture score
    // directly. Multi-fixture runs (Top-N) show the aggregate plus a count.
    if (perFixture.length === 1) {
      const fx = perFixture[0];
      const score = pickObject(fx.score);
      if (score === null) {
        const errMsg = typeof fx.error === "string" ? fx.error : "no score";
        return [
          {
            label: "Fixture",
            value: typeof fx.fixtureId === "string" ? fx.fixtureId : "—",
          },
          { label: "Status", value: errMsg, total: true },
        ];
      }
      return [
        { label: "nDCG@10", value: formatNum(score.ndcgAt10) },
        { label: "nDCG@5", value: formatNum(score.ndcgAt5) },
        { label: "Precision@10", value: formatNum(score.precisionAt10) },
        {
          label: "Must-include recall",
          value: formatNum(score.mustIncludeRecall),
        },
        {
          label: "Rank-1 = must",
          value:
            typeof score.rankOneIsMustInclude === "boolean"
              ? score.rankOneIsMustInclude
                ? "yes"
                : "no"
              : "—",
        },
        {
          label: "Headline · nDCG@10",
          value: formatNum(score.ndcgAt10),
          total: true,
        },
      ];
    }
    return [
      {
        label: "Fixtures scored",
        value: `${String(perFixture.filter((f) => pickObject(f.score) !== null).length)} / ${String(perFixture.length)}`,
      },
      {
        label: "nDCG@10 · mean",
        value: aggregate === null ? "—" : formatNum(aggregate.meanNdcgAt10),
        total: true,
      },
    ];
  }

  if (Array.isArray(sb.calendarRuns)) {
    const calendarRuns = sb.calendarRuns.filter(isCalendarRunReportEntry);
    const done = calendarRuns.filter((entry) => entry.status === "done").length;
    const errors = calendarRuns.length - done;
    return [
      { label: "Calendar runs", value: String(calendarRuns.length) },
      { label: "Completed", value: String(done) },
      { label: "Errors", value: String(errors) },
      { label: "Mode", value: "Calendar comparison", total: true },
    ];
  }

  const saved = Array.isArray(sb.saved) ? sb.saved.length : 0;
  const draft = Array.isArray(sb.draft) ? sb.draft.length : 0;
  return [
    { label: "Saved ranking", value: `${String(saved)} items` },
    { label: "Draft ranking", value: `${String(draft)} items` },
    { label: "Mode", value: "A/B comparison", total: true },
  ];
}

function buildCostRows(run: EvalRun): readonly BreakdownRow[] {
  const cb = pickObject(run.costBreakdown);
  if (cb === null) return [];

  const rows: BreakdownRow[] = [];

  // Mode A: aggregate token detail from the single per-fixture entry when
  // there's exactly one; otherwise just show totalUsd.
  // Mode B: pull from saved + draft.
  if (run.mode === "scored") {
    const perFixture = Array.isArray(cb.perFixture)
      ? (cb.perFixture as { cost?: unknown; fixtureId?: unknown }[])
      : [];
    if (perFixture.length === 1) {
      const cost = pickObject(perFixture[0].cost);
      if (cost !== null) {
        if (cost.tokensIn !== undefined) {
          rows.push({
            label: "Rerank · input",
            value: formatTokens(cost.tokensIn),
            muted: true,
          });
        }
        if (cost.tokensOut !== undefined) {
          rows.push({
            label: "Rerank · output",
            value: formatTokens(cost.tokensOut),
            muted: true,
          });
        }
        if (cost.cacheHit !== undefined) {
          rows.push({
            label: "cache hit",
            value: cost.cacheHit === true ? "yes" : "no",
            sub: true,
          });
        }
      }
    } else if (perFixture.length > 1) {
      rows.push({
        label: "Per-fixture entries",
        value: String(perFixture.length),
        muted: true,
      });
    }
  } else {
    const perRun = Array.isArray(cb.perRun)
      ? (cb.perRun as { cost?: unknown; runId?: unknown }[])
      : [];
    if (perRun.length > 0) {
      rows.push({
        label: "Per-run entries",
        value: String(perRun.length),
        muted: true,
      });
    }
    const saved = pickObject(cb.saved);
    const draft = pickObject(cb.draft);
    if (saved !== null) {
      rows.push({
        label: "Saved · tokens",
        value: `${formatTokens(saved.tokensIn)} → ${formatTokens(saved.tokensOut)}`,
        muted: true,
      });
    }
    if (draft !== null) {
      rows.push({
        label: "Draft · tokens",
        value: `${formatTokens(draft.tokensIn)} → ${formatTokens(draft.tokensOut)}`,
        muted: true,
      });
    }
  }

  rows.push({
    label: "Total cost",
    value:
      typeof cb.totalUsd === "number" && Number.isFinite(cb.totalUsd)
        ? `$${cb.totalUsd.toFixed(4)}`
        : "—",
    total: true,
  });
  return rows;
}

function CalendarReportPanel({
  reports,
}: {
  reports: readonly CalendarRunReportEntry[];
}): ReactElement {
  const doneReports = reports.filter((entry) => entry.status === "done");
  if (doneReports.length === 0) {
    return <EmptyReport reason="failed" />;
  }
  return (
    <div className="min-h-0 overflow-auto p-4" data-testid="calendar-run-report">
      <div className="flex flex-col gap-4">
        {doneReports.map((entry) => (
          <section
            key={entry.runId}
            className="rounded border border-neutral-200 bg-white"
          >
            <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-700">
                Run {shortRunId(entry.runId)}
              </span>
              <span className="font-mono text-[11px] text-neutral-500">
                cost ${entry.cost.usd.toFixed(4)}
              </span>
            </header>
            <div className="p-3">
              <CalendarReportComparison report={entry} density="panel" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function RunDetailDrawer({
  runId,
  onClose,
}: RunDetailDrawerProps): ReactElement {
  const open = runId !== null;
  const query = useQuery<EvalRun, EvalApiError>({
    queryKey: ["eval-run", runId],
    queryFn: () => {
      if (runId === null) throw new Error("runId is null");
      return getEvalRun(runId);
    },
    enabled: open,
  });

  const run = query.data ?? null;
  const reportData = run !== null ? extractReportData(run) : null;
  const calendarReports = run !== null ? extractCalendarReports(run) : [];
  const calendarReportAvailable = calendarReports.length > 0;
  // Done runs that carry report fields default to Report; legacy shapes,
  // running runs, and failed runs default to Prompt & Cost.
  const reportAvailable =
    (run?.mode === "scored" && reportData !== null) || calendarReportAvailable;
  // We can't lazily-init the default off `reportAvailable` because the run
  // fetch is still pending on first render. Track which (runId, available)
  // combination we've already defaulted for; flip to "report" the first time
  // data arrives showing it's available. Once the operator clicks a tab the
  // explicit value wins.
  const [tabState, setTabState] = useState<{
    runId: string | null;
    seenAvailable: boolean;
    tab: DrawerTab;
  }>({ runId: null, seenAvailable: false, tab: "prompt-cost" });

  let activeTab: DrawerTab = tabState.tab;
  const sameRun = tabState.runId === runId;
  if (!sameRun) {
    // New run opened — reset to the default for the current data shape.
    activeTab = reportAvailable ? "report" : "prompt-cost";
    setTabState({
      runId,
      seenAvailable: reportAvailable,
      tab: activeTab,
    });
  } else if (!tabState.seenAvailable && reportAvailable) {
    // Same run, but data has just arrived and report data is now available.
    activeTab = "report";
    setTabState({ runId, seenAvailable: true, tab: "report" });
  }

  const setActiveTab = (next: DrawerTab): void => {
    setTabState({
      runId,
      seenAvailable: tabState.seenAvailable || reportAvailable,
      tab: next,
    });
  };
  const showReportTab = run?.mode === "scored" || calendarReportAvailable;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="run-detail-drawer"
        className="!max-w-[1120px] gap-0 p-0"
        style={{ width: "min(1120px, calc(100vw - 2rem))" }}
      >
        <DialogTitle className="sr-only">Run detail</DialogTitle>
        <DialogDescription className="sr-only">
          Eval run snapshot and breakdowns
        </DialogDescription>

        {query.isLoading ? (
          <div
            data-testid="drawer-loading"
            className="flex h-[540px] items-center justify-center font-mono text-xs uppercase tracking-wider text-neutral-500"
          >
            Loading…
          </div>
        ) : query.isError || run === null ? (
          <div
            data-testid="drawer-error"
            className="flex h-[540px] flex-col items-center justify-center gap-2 p-6"
          >
            <div className="font-mono text-xs uppercase tracking-wider text-red-700">
              Failed to load run
            </div>
            <p className="text-sm text-red-800">
              {query.error?.message ?? "Unknown error"}
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <div className="flex items-center gap-3">
                <span
                  className="font-mono text-sm font-medium text-neutral-800"
                  data-testid="drawer-run-id"
                >
                  r/{run.id.slice(0, 6)}
                </span>
                <StatusChip status={run.status} />
                <span className="inline-flex items-center rounded-sm border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blue-700">
                  {modeLabel(run.mode)}
                </span>
                <span className="font-mono text-[11px] text-neutral-500">
                  started {formatTimestamp(run.startedAt)}
                  {run.finishedAt !== null
                    ? ` · finished ${formatTimestamp(run.finishedAt).slice(11)}`
                    : ""}
                </span>
              </div>
            </header>

            <div className="flex h-[520px] flex-col overflow-hidden">
              {run.status === "failed" && run.errorMessage !== null ? (
                <div
                  data-testid="drawer-error-banner"
                  className="m-4 rounded border border-rose-200 bg-rose-50 p-3"
                >
                  <div className="font-mono text-[11px] uppercase tracking-wider text-rose-700">
                    Run failed
                  </div>
                  <p className="mt-1 font-mono text-xs whitespace-pre-wrap text-rose-900">
                    {run.errorMessage}
                  </p>
                </div>
              ) : null}

              <div
                role="tablist"
                aria-label="Run detail views"
                className="flex border-b border-neutral-200 bg-neutral-50/50"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "prompt-cost"}
                  aria-controls="drawer-tab-panel-prompt-cost"
                  data-testid="drawer-tab-prompt-cost"
                  onClick={() => {
                    setActiveTab("prompt-cost");
                  }}
                  className={`border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-wider ${
                    activeTab === "prompt-cost"
                      ? "border-[#8c3a1e] text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  Prompt & Cost
                </button>
                {showReportTab ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "report"}
                    aria-controls="drawer-tab-panel-report"
                    data-testid="drawer-tab-report"
                    onClick={() => {
                      setActiveTab("report");
                    }}
                    className={`border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-wider ${
                      activeTab === "report"
                        ? "border-[#8c3a1e] text-neutral-900"
                        : "border-transparent text-neutral-500 hover:text-neutral-800"
                    }`}
                  >
                    Report
                  </button>
                ) : null}
              </div>

              {activeTab === "prompt-cost" ? (
                <div
                  id="drawer-tab-panel-prompt-cost"
                  role="tabpanel"
                  data-testid="drawer-tab-panel-prompt-cost"
                  className="grid min-h-0 flex-1"
                  style={{ gridTemplateColumns: "1.4fr 1fr" }}
                >
                  <div className="min-h-0 overflow-auto border-r border-neutral-200">
                    <SnapshotPane
                      hash={run.draftPromptHash}
                      snapshot={run.draftPromptSnapshot}
                    />
                  </div>

                  <div className="min-h-0 overflow-auto">
                    <header className="flex items-baseline justify-between border-b border-neutral-200 px-4 py-3">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-700">
                        Score breakdown
                      </span>
                      <span className="font-mono text-[11px] text-neutral-400">
                        {run.fixtureId !== null
                          ? `fixture · ${run.fixtureId}`
                          : run.date !== null
                            ? `date · ${run.date}`
                            : "—"}
                      </span>
                    </header>
                    {run.status === "running" ? (
                      <div
                        data-testid="drawer-running-placeholder-score"
                        className="px-4 py-6 font-mono text-[11px] text-neutral-400"
                      >
                        Run still in progress…
                      </div>
                    ) : (
                      <BreakdownTable
                        rows={buildScoreRows(run)}
                        testId="drawer-score-breakdown"
                      />
                    )}

                    <header className="flex items-baseline justify-between border-b border-neutral-200 px-4 py-3">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-700">
                        Cost breakdown
                      </span>
                      <span className="font-mono text-[11px] text-neutral-400">
                        {(() => {
                          const cb = run.costBreakdown;
                          if (cb !== null && typeof cb === "object") {
                            const model = (cb as { model?: unknown }).model;
                            if (typeof model === "string") return model;
                          }
                          return "—";
                        })()}
                      </span>
                    </header>
                    {run.status === "running" ? (
                      <div
                        data-testid="drawer-running-placeholder-cost"
                        className="px-4 py-6 font-mono text-[11px] text-neutral-400"
                      >
                        Run still in progress…
                      </div>
                    ) : (
                      <BreakdownTable
                        rows={buildCostRows(run)}
                        testId="drawer-cost-breakdown"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div
                  id="drawer-tab-panel-report"
                  role="tabpanel"
                  data-testid="drawer-tab-panel-report"
                  className="flex min-h-0 flex-1 flex-col"
                >
                  {reportData !== null ? (
                    <ReportTab
                      actualRanking={reportData.actual}
                      expectedRanking={reportData.expected}
                      scoreSheet={reportData.scoreSheet}
                    />
                  ) : calendarReportAvailable ? (
                    <CalendarReportPanel reports={calendarReports} />
                  ) : (
                    <EmptyReport
                      reason={
                        run.status === "running"
                          ? "running"
                          : run.status === "failed"
                            ? "failed"
                            : "legacy"
                      }
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
