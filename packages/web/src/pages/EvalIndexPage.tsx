import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Newspaper } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import { useEvalFixtures } from "../hooks/useEvalFixtures";
import {
  listCalendarRuns,
  runEval,
  saveDraftPrompt,
  EvalApiError,
  type EvalRunStream,
} from "../api/eval";
import type {
  ActualRankingItem,
  CalendarRunReportEntry,
  CalendarRunSummary,
  EvalScore,
  ExpectedRankingItem,
  PerFixtureCost,
  SourcingReportRow,
} from "@newsletter/shared/types/eval-ranking";
import { PromptDiffModal } from "../components/eval/PromptDiffModal";
import { type EvalProgressRow } from "../components/eval/EvalResultsPanel";
import { EvalAggregateHero } from "../components/eval/EvalAggregateHero";
import { SourcingReportPanel } from "../components/eval/SourcingReportPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReportTab, type ReportScoreSheet } from "../components/eval/ReportTab";
import { CalendarReportComparison } from "../components/eval/CalendarReportComparison";
import {
  configuredTimezone,
  formatDateTimeForTimezone,
  todayInTimezone,
} from "../lib/dateSelectorTimezone";

type Mode = "scored" | "ab";

interface ScoredProgressPayload {
  fixtureId: string;
  status: "running" | "done" | "error";
  score?: EvalScore;
  cost?: PerFixtureCost;
  error?: string;
  actualRanking?: ActualRankingItem[];
  expectedRanking?: ExpectedRankingItem[];
}

type CalendarProgressRow =
  | { runId: string; status: "running" }
  | CalendarRunReportEntry;

const RUN_STATE_KEY = "eval-run-state";
const RUN_STATE_VERSION = 1;
const RUN_STATE_TTL_MS = 60 * 60 * 1000;

interface PersistedRunState {
  version: number;
  mode: "scored";
  fixtureId: string;
  rows: EvalProgressRow[];
  totalUsd: number | null;
  runError: string | null;
  persistedAt: number;
}

function safeSessionGet(): PersistedRunState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RUN_STATE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRunState>;
    if (
      parsed.version !== RUN_STATE_VERSION ||
      parsed.mode !== "scored" ||
      typeof parsed.persistedAt !== "number"
    ) {
      window.sessionStorage.removeItem(RUN_STATE_KEY);
      return null;
    }
    if (Date.now() - parsed.persistedAt > RUN_STATE_TTL_MS) {
      window.sessionStorage.removeItem(RUN_STATE_KEY);
      return null;
    }
    return parsed as PersistedRunState;
  } catch {
    return null;
  }
}

function safeSessionSet(state: PersistedRunState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RUN_STATE_KEY, JSON.stringify(state));
  } catch {
    // quota / disabled — silently swallow, runs continue uninterrupted.
  }
}

function safeSessionClear(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RUN_STATE_KEY);
  } catch {
    // ignore
  }
}

function fmtNumber(n: number, digits = 3): string {
  if (Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTimestamp(
  iso: string | null,
  timezone: string | null | undefined,
): string {
  return formatDateTimeForTimezone(iso, timezone);
}

function hasReportPayload(
  row: EvalProgressRow,
): row is EvalProgressRow & { actualRanking: ActualRankingItem[] } {
  return (
    row.status === "done" &&
    Array.isArray(row.actualRanking)
  );
}

function scoreSheetFromScore(score: EvalScore | undefined): ReportScoreSheet | null {
  if (score === undefined) return null;
  return {
    ndcgAt10: score.ndcgAt10,
    ndcgAt5: null,
    precisionAt10: score.precisionAt10,
    mustIncludeRecall: score.mustIncludeRecall,
    rankOneIsMustInclude: score.rankOneIsMustInclude,
  };
}

function isCalendarReportRow(
  row: CalendarProgressRow,
): row is CalendarRunReportEntry {
  return row.status === "done" || row.status === "error";
}

function isCalendarDoneRow(
  row: CalendarProgressRow,
): row is Extract<CalendarRunReportEntry, { status: "done" }> {
  return row.status === "done";
}

function upsertCalendarRow(
  rows: readonly CalendarProgressRow[],
  nextRow: CalendarProgressRow,
): CalendarProgressRow[] {
  const idx = rows.findIndex((row) => row.runId === nextRow.runId);
  if (idx === -1) return [...rows, nextRow];
  return rows.map((row, rowIdx) => (rowIdx === idx ? nextRow : row));
}

function calendarRunLabel(run: CalendarRunSummary): string {
  return run.digestHeadline ?? `Run ${shortId(run.runId)}`;
}

function countLines(s: string): number {
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) === 10) n += 1;
  return n;
}

interface CalendarReportDialogProps {
  row: Extract<CalendarRunReportEntry, { status: "done" }> | null;
  onClose: () => void;
}

function CalendarReportDialog({
  row,
  onClose,
}: CalendarReportDialogProps): ReactElement {
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="calendar-report-dialog"
        className="flex h-[90vh] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        style={{ width: "min(1320px, calc(100vw - 2rem))" }}
      >
        <header className="border-b border-neutral-200 px-6 py-5">
          <DialogTitle className="text-2xl leading-tight">
            Calendar report{row === null ? "" : ` · ${shortId(row.runId)}`}
          </DialogTitle>
          <DialogDescription className="mt-2 text-base">
            Previous ranked items compared with the draft-prompt ranking.
          </DialogDescription>
        </header>
        {row !== null ? (
          <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
            <CalendarReportComparison report={row} density="dialog" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function EvalIndexPage(): ReactElement {
  const settingsQuery = useSettings();
  const fixturesQuery = useEvalFixtures();
  const queryClient = useQueryClient();

  const savedPrompt = settingsQuery.data?.rankingPrompt ?? "";
  const timezone = useMemo(
    () => configuredTimezone(settingsQuery.data?.scheduleTimezone),
    [settingsQuery.data?.scheduleTimezone],
  );
  const today = useMemo(() => todayInTimezone(timezone), [timezone]);
  const [draft, setDraft] = useState("");
  const seededRef = useRef(false);
  const calendarDateTouchedRef = useRef(false);

  useEffect(() => {
    if (!seededRef.current && settingsQuery.data) {
      setDraft(settingsQuery.data.rankingPrompt);
      seededRef.current = true;
    }
  }, [settingsQuery.data]);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode: Mode = searchParams.get("mode") === "ab" ? "ab" : "scored";
  const initialFixtureId = searchParams.get("fixtureId") ?? "";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [fixtureId, setFixtureId] = useState(initialFixtureId);
  const [bypassCache, setBypassCache] = useState(false);
  const [calendarDate, setCalendarDate] = useState(() => todayInTimezone("UTC"));
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<EvalProgressRow[]>([]);
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [calendarRows, setCalendarRows] = useState<CalendarProgressRow[]>([]);
  const [sourcing, setSourcing] = useState<SourcingReportRow[]>([]);
  const [reportRow, setReportRow] = useState<EvalProgressRow | null>(null);
  const [calendarReportRow, setCalendarReportRow] =
    useState<Extract<CalendarRunReportEntry, { status: "done" }> | null>(null);
  const streamRef = useRef<EvalRunStream | null>(null);

  const dirty = draft !== savedPrompt;

  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (calendarDateTouchedRef.current) return;
    setCalendarDate(today);
  }, [today]);

  const calendarRunsQuery = useQuery({
    queryKey: ["eval", "calendar-runs", calendarDate],
    queryFn: () => listCalendarRuns(calendarDate),
    enabled: mode === "ab" && /^\d{4}-\d{2}-\d{2}$/.test(calendarDate),
  });

  const saveMutation = useMutation({
    mutationFn: (prompt: string) => saveDraftPrompt(prompt),
    onSuccess: async () => {
      toast.success("Ranking prompt saved");
      setShowDiff(false);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof EvalApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed";
      toast.error(msg);
    },
  });

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const persisted = safeSessionGet();
    if (persisted === null) return;
    setMode("scored");
    if (initialFixtureId.length === 0 && persisted.fixtureId.length > 0) {
      setFixtureId(persisted.fixtureId);
    }
    setRows(persisted.rows);
    setTotalUsd(persisted.totalUsd);
    setRunError(persisted.runError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "scored") return;
    if (rows.length === 0 && totalUsd === null && runError === null) return;
    safeSessionSet({
      version: RUN_STATE_VERSION,
      mode: "scored",
      fixtureId,
      rows,
      totalUsd,
      runError,
      persistedAt: Date.now(),
    });
  }, [mode, fixtureId, rows, totalUsd, runError]);

  useEffect(() => {
    setSelectedRunIds([]);
    setCalendarRows([]);
    setTotalUsd(null);
    setRunError(null);
  }, [calendarDate]);

  function resetResults(): void {
    setRows([]);
    setTotalUsd(null);
    setRunError(null);
    setCalendarRows([]);
    setSourcing([]);
    safeSessionClear();
  }

  function toggleCalendarRun(runId: string): void {
    setSelectedRunIds((prev) =>
      prev.includes(runId)
        ? prev.filter((id) => id !== runId)
        : [...prev, runId],
    );
  }

  async function handleRun(): Promise<void> {
    if (running) return;
    if (mode === "scored" && !fixtureId) {
      toast.error("Pick a fixture first");
      return;
    }
    if (mode === "ab" && !dirty) {
      toast.error("Edit the prompt before running Mode B");
      return;
    }
    if (mode === "ab" && selectedRunIds.length === 0) {
      toast.error("Select at least one run");
      return;
    }
    resetResults();
    setRunning(true);
    const stream = runEval({
      mode,
      fixtureId: mode === "scored" ? fixtureId : undefined,
      date: mode === "ab" ? calendarDate : undefined,
      runIds: mode === "ab" ? selectedRunIds : undefined,
      draftPrompt: draft,
      bypassCache: mode === "scored" ? bypassCache : undefined,
    });
    streamRef.current = stream;
    try {
      for await (const ev of stream.progress) {
        if (ev.event === "progress") {
          if (mode === "ab") {
            const payload = ev.data as CalendarProgressRow;
            setCalendarRows((prev) => upsertCalendarRow(prev, payload));
            continue;
          }
          const payload = ev.data as ScoredProgressPayload;
          setRows((prev) => {
            const idx = prev.findIndex(
              (r) => r.fixtureId === payload.fixtureId,
            );
            const next = [...prev];
            const row: EvalProgressRow = {
              fixtureId: payload.fixtureId,
              status: payload.status,
              score: payload.score,
              cost: payload.cost,
              error: payload.error,
              ...(payload.actualRanking === undefined
                ? {}
                : { actualRanking: payload.actualRanking }),
              ...(payload.expectedRanking === undefined
                ? {}
                : { expectedRanking: payload.expectedRanking }),
            };
            if (idx >= 0) next[idx] = row;
            else next.push(row);
            return next;
          });
        } else if (ev.event === "aggregate" || ev.event === "done") {
          const payload = ev.data as {
            totalCost?: { usd?: number };
            calendarRuns?: CalendarRunReportEntry[];
            sourcingReport?: SourcingReportRow[];
          };
          if (typeof payload.totalCost?.usd === "number") {
            setTotalUsd(payload.totalCost.usd);
          }
          if (payload.calendarRuns && payload.calendarRuns.length > 0) {
            setCalendarRows(payload.calendarRuns);
          }
          if (payload.sourcingReport) setSourcing(payload.sourcingReport);
        } else if (ev.event === "error") {
          const payload = ev.data as { message?: string };
          setRunError(payload.message ?? "run failed");
        }
      }
    } finally {
      setRunning(false);
      streamRef.current = null;
    }
  }

  function handleStop(): void {
    streamRef.current?.abort();
    setRunning(false);
  }

  function switchMode(next: Mode): void {
    setMode(next);
    const params = new URLSearchParams(searchParams);
    if (next === "scored") params.delete("mode");
    else params.set("mode", next);
    setSearchParams(params, { replace: true });
  }

  const fixtures = useMemo(
    () => fixturesQuery.data?.fixtures ?? [],
    [fixturesQuery.data],
  );
  const calendarRuns = calendarRunsQuery.data?.runs ?? [];

  const showHero = mode === "scored" && rows.length > 0;

  return (
    <>
      <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 font-semibold min-h-[44px]"
        >
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 min-h-[44px]"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
        {/* Page header strip */}
        <div className="flex flex-col gap-3 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500">
              Eval · Prompt iteration
            </div>
            <h1 className="mt-2 font-serif text-[36px] font-medium leading-tight tracking-tight text-neutral-900">
              Tune the ranker
            </h1>
            <p className="mt-2 text-sm text-neutral-600">
              Edit the ranking prompt, score it against a graded fixture, then
              save when satisfied. Saved prompt powers the next daily run.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/eval/runs"
              data-testid="past-runs-link"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-neutral-700 hover:bg-neutral-50"
            >
              Past runs
            </Link>
            <Link
              to="/admin/eval/fixtures/new"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              + New fixture
            </Link>
          </div>
        </div>

        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}
        >
          {/* LEFT column */}
          <div className="flex min-w-0 flex-col gap-6">
            {/* Editor */}
            <section
              data-testid="prompt-column"
              className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/60 px-5 py-3">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-800">
                    Ranking prompt · draft
                  </span>
                  {dirty ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                      unsaved
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-neutral-500">
                      saved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!dirty}
                    onClick={() => {
                      setDraft(savedPrompt);
                    }}
                  >
                    Reset to saved
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty}
                    onClick={() => {
                      setShowDiff(true);
                    }}
                  >
                    Save as current prompt
                  </Button>
                </div>
              </header>
              <textarea
                data-testid="prompt-editor-textarea"
                aria-label="Ranking prompt"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                spellCheck={false}
                className="block h-[520px] w-full resize-vertical border-0 bg-white px-6 py-5 font-mono text-[13px] leading-[1.7] text-neutral-900 focus:outline-none"
              />
              <footer className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50/60 px-5 py-3 font-mono text-[11px] text-neutral-500">
                <span>
                  {draft.length.toLocaleString()} chars ·{" "}
                  {String(countLines(draft))} lines
                </span>
                <span>{dirty ? "unsaved changes" : "in sync with saved"}</span>
              </footer>
            </section>

            {/* Aggregate hero — only when rows present in scored mode */}
            {showHero ? (
              <EvalAggregateHero
                rows={rows}
                totalUsd={totalUsd}
                running={running}
              />
            ) : null}

            {runError ? (
              <div
                data-testid="run-error"
                className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                {runError}
              </div>
            ) : null}

            {/* Per-fixture results table — scored mode */}
            {mode === "scored" ? (
              <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/60 px-5 py-3">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-700">
                    Per-fixture results
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    {rows.length === 0
                      ? "no runs yet"
                      : `${String(rows.length)} fixture${rows.length === 1 ? "" : "s"}`}
                  </span>
                </header>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left">
                      <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Fixture
                      </th>
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Status
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        nDCG@10
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        P@10
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Recall
                      </th>
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        R1=must
                      </th>
                      <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Cost
                      </th>
                      <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Report
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-5 py-6 text-center font-mono text-xs text-neutral-500"
                        >
                          No runs yet.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => {
                        const ndcgPct =
                          r.score === undefined
                            ? 0
                            : Math.max(0, Math.min(1, r.score.ndcgAt10)) * 100;
                        return (
                          <tr
                            key={r.fixtureId}
                            data-testid="eval-result-row"
                            data-fixture-id={r.fixtureId}
                            className="border-b border-neutral-100 last:border-none"
                          >
                            <td className="px-5 py-3 font-mono text-xs font-medium text-neutral-900">
                              {r.fixtureId}
                            </td>
                            <td className="px-3 py-3">
                              {r.status === "done" ? (
                                <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700">
                                  done
                                </span>
                              ) : r.status === "running" ? (
                                <span className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-700">
                                  running
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-sm bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-rose-700">
                                  error
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                              {r.score ? (
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className="relative inline-block h-1 w-[60px] overflow-hidden rounded-sm bg-neutral-200 align-middle"
                                    aria-hidden
                                  >
                                    <span
                                      className="absolute inset-y-0 left-0"
                                      style={{
                                        width: `${ndcgPct.toFixed(0)}%`,
                                        background: "#8c3a1e",
                                      }}
                                    />
                                  </span>
                                  {fmtNumber(r.score.ndcgAt10)}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                              {r.score ? fmtNumber(r.score.precisionAt10) : "—"}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                              {r.score
                                ? fmtNumber(r.score.mustIncludeRecall)
                                : "—"}
                            </td>
                            <td className="px-3 py-3 font-mono text-xs">
                              {r.score
                                ? r.score.rankOneIsMustInclude
                                  ? "yes"
                                  : "no"
                                : "—"}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                              {r.cost ? (
                                <span>
                                  {fmtUsd(r.cost.usd)}{" "}
                                  {r.cost.cacheHit ? (
                                    <span className="ml-1 text-neutral-500">
                                      cached
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                "—"
                              )}
                              {r.error ? (
                                <div className="text-rose-700">{r.error}</div>
                              ) : null}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {hasReportPayload(r) ? (
                                <button
                                  type="button"
                                  aria-label={`Report for ${r.fixtureId}`}
                                  onClick={() => {
                                    setReportRow(r);
                                  }}
                                  className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-700 hover:bg-neutral-50"
                                >
                                  Report
                                </button>
                              ) : (
                                <span className="font-mono text-xs text-neutral-300">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {totalUsd !== null ? (
                  <footer className="border-t border-neutral-200 bg-neutral-50/60 px-5 py-2 text-right font-mono text-[11px] text-neutral-500">
                    total cost: {fmtUsd(totalUsd)}
                  </footer>
                ) : null}
              </section>
            ) : (
              <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/60 px-5 py-3">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-700">
                    Calendar results
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    {calendarRows.length === 0
                      ? "no runs yet"
                      : `${String(calendarRows.length)} run${calendarRows.length === 1 ? "" : "s"}`}
                  </span>
                </header>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left">
                      <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Run
                      </th>
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Status
                      </th>
                      <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Cost
                      </th>
                      <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                        Report
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendarRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-5 py-6 text-center font-mono text-xs text-neutral-500"
                        >
                          No calendar eval runs yet.
                        </td>
                      </tr>
                    ) : (
                      calendarRows.map((row) => (
                        <tr
                          key={row.runId}
                          data-testid="calendar-result-row"
                          className="border-b border-neutral-100 last:border-none"
                        >
                          <td className="px-5 py-3 font-mono text-xs font-medium text-neutral-900">
                            {shortId(row.runId)}
                          </td>
                          <td className="px-3 py-3">
                            {row.status === "done" ? (
                              <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700">
                                done
                              </span>
                            ) : row.status === "running" ? (
                              <span className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-700">
                                running
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-sm bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-rose-700">
                                error
                              </span>
                            )}
                            {isCalendarReportRow(row) && row.status === "error" ? (
                              <div className="mt-1 text-xs text-rose-700">
                                {row.error}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                            {isCalendarDoneRow(row) ? fmtUsd(row.cost.usd) : "—"}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {isCalendarDoneRow(row) ? (
                              <button
                                type="button"
                                aria-label={`Report for calendar run ${shortId(row.runId)}`}
                                onClick={() => {
                                  setCalendarReportRow(row);
                                }}
                                className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-700 hover:bg-neutral-50"
                              >
                                Report
                              </button>
                            ) : (
                              <span className="font-mono text-xs text-neutral-300">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {totalUsd !== null ? (
                  <footer className="border-t border-neutral-200 bg-neutral-50/60 px-5 py-2 text-right font-mono text-[11px] text-neutral-500">
                    total cost: {fmtUsd(totalUsd)}
                  </footer>
                ) : null}
              </section>
            )}

            {mode === "scored" ? (
              <SourcingReportPanel rows={sourcing} />
            ) : null}
          </div>

          {/* RIGHT control rail */}
          <aside className="flex flex-col gap-4" data-testid="run-column">
            <div className="sticky top-4 flex flex-col gap-4">
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="p-4">
                  <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-[3px]">
                    <button
                      type="button"
                      onClick={() => {
                        switchMode("scored");
                      }}
                      className={`rounded-sm px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wider transition-all ${
                        mode === "scored"
                          ? "bg-white text-neutral-900 shadow-sm"
                          : "text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      Mode A · Scored
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        switchMode("ab");
                      }}
                      className={`rounded-sm px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wider transition-all ${
                        mode === "ab"
                          ? "bg-white text-neutral-900 shadow-sm"
                          : "text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      Mode B · Calendar
                    </button>
                  </div>

                  {mode === "scored" ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label
                            htmlFor="fixture-select"
                            className="font-mono text-[10px] uppercase tracking-widest text-neutral-500"
                          >
                            Fixture
                          </label>
                          <Link
                            to="/admin/eval/fixtures/new"
                            data-testid="new-fixture-link"
                            className="font-mono text-[11px] uppercase tracking-wider text-[#8c3a1e] hover:underline"
                          >
                            + New fixture
                          </Link>
                        </div>
                        <select
                          id="fixture-select"
                          data-testid="fixture-select"
                          className="block w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                          value={fixtureId}
                          onChange={(e) => {
                            setFixtureId(e.target.value);
                          }}
                        >
                          <option value="">— pick a fixture —</option>
                          {fixtures.map((f) => (
                            <option
                              key={f.fixtureId}
                              value={f.fixtureId}
                              disabled={f.gradingStatus !== "graded"}
                            >
                              {f.fixtureId} ({f.gradingStatus})
                            </option>
                          ))}
                        </select>
                      </div>

                      <label className="flex items-center gap-2 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          checked={bypassCache}
                          onChange={(e) => {
                            setBypassCache(e.target.checked);
                          }}
                          className="h-4 w-4"
                        />
                        Bypass response cache
                      </label>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          data-testid="run-mode-a"
                          disabled={running || !fixtureId}
                          onClick={() => {
                            void handleRun();
                          }}
                          className="w-full justify-center"
                          style={{
                            background: running ? undefined : "#8c3a1e",
                            color: running ? undefined : "#fff",
                          }}
                        >
                          {running ? "Running…" : "Run scored eval"}
                        </Button>
                        {running ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleStop}
                          >
                            Stop
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div>
                        <label
                          htmlFor="ab-date"
                          className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-neutral-500"
                        >
                          Date
                        </label>
                        <input
                          id="ab-date"
                          data-testid="ab-date"
                          type="date"
                          value={calendarDate}
                          max={today}
                          onChange={(e) => {
                            calendarDateTouchedRef.current = true;
                            setCalendarDate(e.target.value);
                          }}
                          className="block w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                        />
                      </div>
                      {!dirty ? (
                        <p
                          data-testid="ab-hint"
                          className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800"
                        >
                          Draft matches saved — edit the prompt to see a diff.
                        </p>
                      ) : null}
                      <section className="rounded-md border border-neutral-200">
                        <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                          <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                            Runs on date
                          </span>
                          <span className="font-mono text-[11px] text-neutral-500">
                            {calendarRunsQuery.isLoading
                              ? "loading"
                              : `${String(calendarRuns.length)} run${calendarRuns.length === 1 ? "" : "s"}`}
                          </span>
                        </header>
                        <div className="max-h-[260px] overflow-auto">
                          {calendarRunsQuery.isError ? (
                            <div className="px-3 py-4 text-xs text-rose-700">
                              Failed to load runs.
                            </div>
                          ) : calendarRuns.length === 0 ? (
                            <div className="px-3 py-4 font-mono text-xs text-neutral-500">
                              No completed runs for this date.
                            </div>
                          ) : (
                            calendarRuns.map((run) => (
                              <label
                                key={run.runId}
                                className="flex cursor-pointer gap-3 border-b border-neutral-100 px-3 py-2 last:border-none hover:bg-neutral-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRunIds.includes(run.runId)}
                                  onChange={() => {
                                    toggleCalendarRun(run.runId);
                                  }}
                                  aria-label={`Select calendar run ${shortId(run.runId)}`}
                                  className="mt-1 h-4 w-4"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-neutral-900">
                                    {calendarRunLabel(run)}
                                  </span>
                                  <span className="block font-mono text-[11px] text-neutral-500">
                                    {shortId(run.runId)} ·{" "}
                                    {String(run.itemCount)} items · top{" "}
                                    {String(run.topN)}
                                  </span>
                                  <span className="block truncate text-[11px] text-neutral-500">
                                    {formatTimestamp(run.completedAt, timezone)} ·{" "}
                                    {run.sourceTypes.join(", ") || "sources n/a"}
                                  </span>
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </section>
                      <Button
                        type="button"
                        data-testid="run-mode-b"
                        disabled={running || !dirty || selectedRunIds.length === 0}
                        onClick={() => {
                          void handleRun();
                        }}
                        className="w-full justify-center"
                        style={{
                          background:
                            running || !dirty || selectedRunIds.length === 0
                              ? undefined
                              : "#8c3a1e",
                          color:
                            running || !dirty || selectedRunIds.length === 0
                              ? undefined
                              : "#fff",
                        }}
                      >
                        {running ? "Running…" : "Run calendar eval"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>

        <PromptDiffModal
          open={showDiff}
          current={savedPrompt}
          draft={draft}
          saving={saveMutation.isPending}
          onCancel={() => {
            setShowDiff(false);
          }}
          onConfirm={() => {
            saveMutation.mutate(draft);
          }}
        />
        </main>
      </div>
      <Dialog
        open={reportRow !== null}
        onOpenChange={(open) => {
          if (!open) setReportRow(null);
        }}
      >
        <DialogContent className="flex h-[80vh] max-w-5xl flex-col">
          <DialogTitle>
            Report{reportRow === null ? "" : ` · ${reportRow.fixtureId}`}
          </DialogTitle>
          <DialogDescription>
            Per-fixture actual ranking compared with graded expected order.
          </DialogDescription>
          {reportRow !== null && hasReportPayload(reportRow) ? (
            <ReportTab
              actualRanking={reportRow.actualRanking}
              expectedRanking={reportRow.expectedRanking}
              scoreSheet={scoreSheetFromScore(reportRow.score)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <CalendarReportDialog
        row={calendarReportRow}
        onClose={() => {
          setCalendarReportRow(null);
        }}
      />
    </>
  );
}
