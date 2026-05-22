import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Newspaper } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import { useEvalFixtures } from "../hooks/useEvalFixtures";
import {
  runEval,
  saveDraftPrompt,
  EvalApiError,
  type EvalRunStream,
} from "../api/eval";
import type {
  EvalScore,
  PerFixtureCost,
  SourcingReportRow,
} from "@newsletter/shared/types/eval-ranking";
import { PromptDiffModal } from "../components/eval/PromptDiffModal";
import { type EvalProgressRow } from "../components/eval/EvalResultsPanel";
import { EvalAggregateHero } from "../components/eval/EvalAggregateHero";
import {
  ABResultsPanel,
  type AbItem,
} from "../components/eval/ABResultsPanel";
import { SourcingReportPanel } from "../components/eval/SourcingReportPanel";
import { Button } from "@/components/ui/button";

type Mode = "scored" | "ab";
type ScoredScope = "single" | "topN";

interface ScoredProgressPayload {
  fixtureId: string;
  status: "running" | "done" | "error";
  score?: EvalScore;
  cost?: PerFixtureCost;
  error?: string;
}

interface AbDonePayload {
  saved?: AbItem[];
  draft?: AbItem[];
}

function formatTodayIso(): string {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const RUN_STATE_KEY = "eval-run-state";
const RUN_STATE_VERSION = 1;
const RUN_STATE_TTL_MS = 60 * 60 * 1000;

interface PersistedRunState {
  version: number;
  mode: "scored";
  scoredScope: ScoredScope;
  fixtureId: string;
  windowSize: number;
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

function countLines(s: string): number {
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) === 10) n += 1;
  return n;
}

export function EvalIndexPage(): ReactElement {
  const settingsQuery = useSettings();
  const fixturesQuery = useEvalFixtures();
  const queryClient = useQueryClient();

  const savedPrompt = settingsQuery.data?.rankingPrompt ?? "";
  const [draft, setDraft] = useState("");
  const seededRef = useRef(false);

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
  const [scoredScope, setScoredScope] = useState<ScoredScope>("single");
  const [fixtureId, setFixtureId] = useState(initialFixtureId);
  const [windowSize, setWindowSize] = useState(20);
  const [forceWindow, setForceWindow] = useState(false);
  const [bypassCache, setBypassCache] = useState(false);
  const [calendarDate, setCalendarDate] = useState(formatTodayIso());

  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<EvalProgressRow[]>([]);
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [abSaved, setAbSaved] = useState<AbItem[]>([]);
  const [abDraft, setAbDraft] = useState<AbItem[]>([]);
  const [sourcing, setSourcing] = useState<SourcingReportRow[]>([]);
  const [showCostConfirm, setShowCostConfirm] = useState(false);
  const streamRef = useRef<EvalRunStream | null>(null);

  const dirty = draft !== savedPrompt;

  const [showDiff, setShowDiff] = useState(false);

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
    setScoredScope(persisted.scoredScope);
    if (initialFixtureId.length === 0 && persisted.fixtureId.length > 0) {
      setFixtureId(persisted.fixtureId);
    }
    setWindowSize(persisted.windowSize);
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
      scoredScope,
      fixtureId,
      windowSize,
      rows,
      totalUsd,
      runError,
      persistedAt: Date.now(),
    });
  }, [mode, scoredScope, fixtureId, windowSize, rows, totalUsd, runError]);

  function resetResults(): void {
    setRows([]);
    setTotalUsd(null);
    setRunError(null);
    setAbSaved([]);
    setAbDraft([]);
    setSourcing([]);
    safeSessionClear();
  }

  const COST_PER_FIXTURE_USD_ESTIMATE = 0.01;

  function estimatedUsd(): number {
    return windowSize * COST_PER_FIXTURE_USD_ESTIMATE;
  }

  async function handleRun(forceWindowOverride = false): Promise<void> {
    if (running) return;
    if (mode === "scored" && scoredScope === "single" && !fixtureId) {
      toast.error("Pick a fixture first");
      return;
    }
    if (mode === "ab" && !dirty) {
      toast.error("Edit the prompt before running Mode B");
      return;
    }
    const isTopN = mode === "scored" && scoredScope === "topN";
    const effectiveForce = forceWindow || forceWindowOverride;
    if (isTopN && windowSize > 60 && !effectiveForce) {
      setShowCostConfirm(true);
      return;
    }
    setShowCostConfirm(false);
    resetResults();
    setRunning(true);
    const stream = runEval({
      mode,
      fixtureId:
        mode === "scored" && scoredScope === "single" ? fixtureId : undefined,
      date: mode === "ab" ? calendarDate : undefined,
      draftPrompt: draft,
      windowSize: isTopN ? windowSize : undefined,
      forceWindow: isTopN && effectiveForce ? true : undefined,
      bypassCache: mode === "scored" ? bypassCache : undefined,
    });
    streamRef.current = stream;
    try {
      for await (const ev of stream.progress) {
        if (ev.event === "progress") {
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
            };
            if (idx >= 0) next[idx] = row;
            else next.push(row);
            return next;
          });
        } else if (ev.event === "aggregate" || ev.event === "done") {
          const payload = ev.data as {
            totalCost?: { usd?: number };
            saved?: AbItem[];
            draft?: AbItem[];
            sourcingReport?: SourcingReportRow[];
          };
          if (typeof payload.totalCost?.usd === "number") {
            setTotalUsd(payload.totalCost.usd);
          }
          if (payload.saved || payload.draft) {
            const abPayload = payload as AbDonePayload;
            if (abPayload.saved) setAbSaved(abPayload.saved);
            if (abPayload.draft) setAbDraft(abPayload.draft);
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

  const showHero = mode === "scored" && rows.length > 0;

  return (
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
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
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
              <ABResultsPanel saved={abSaved} draft={abDraft} />
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
                      <fieldset data-testid="scope-toggle">
                        <legend className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                          Scope
                        </legend>
                        <div className="flex gap-4 text-sm">
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name="scored-scope"
                              data-testid="scope-single"
                              value="single"
                              checked={scoredScope === "single"}
                              onChange={() => {
                                setScoredScope("single");
                                setForceWindow(false);
                              }}
                            />
                            <span>Single fixture</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name="scored-scope"
                              data-testid="scope-topn"
                              value="topN"
                              checked={scoredScope === "topN"}
                              onChange={() => {
                                setScoredScope("topN");
                              }}
                            />
                            <span>Top-N recent</span>
                          </label>
                        </div>
                      </fieldset>

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
                          disabled={scoredScope !== "single"}
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

                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label
                            htmlFor="window-slider"
                            className="font-mono text-[10px] uppercase tracking-widest text-neutral-500"
                          >
                            Window size
                          </label>
                          <span className="font-mono text-[13px] font-medium tabular-nums text-neutral-900">
                            {String(windowSize)}
                          </span>
                        </div>
                        <input
                          id="window-slider"
                          data-testid="window-slider"
                          type="range"
                          min={1}
                          max={60}
                          value={windowSize}
                          disabled={scoredScope !== "topN"}
                          onChange={(e) => {
                            setWindowSize(Number(e.target.value));
                          }}
                          className="block w-full"
                          style={{ accentColor: "#8c3a1e" }}
                        />
                        {scoredScope === "single" ? (
                          <p className="mt-1 font-mono text-[11px] text-neutral-500">
                            Disabled · scope is Single fixture
                          </p>
                        ) : null}
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
                          disabled={
                            running ||
                            (scoredScope === "single" && !fixtureId)
                          }
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
                          max={formatTodayIso()}
                          onChange={(e) => {
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
                      <Button
                        type="button"
                        data-testid="run-mode-b"
                        disabled={running || !dirty}
                        onClick={() => {
                          void handleRun();
                        }}
                        className="w-full justify-center"
                        style={{
                          background:
                            running || !dirty ? undefined : "#8c3a1e",
                          color: running || !dirty ? undefined : "#fff",
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

        {showCostConfirm ? (
          <div
            data-testid="cost-confirm-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-4">
              <h2 className="text-lg font-semibold">Confirm large run</h2>
              <p className="mt-2 text-sm text-neutral-600">
                You are about to run {String(windowSize)} fixtures. Estimated
                cost:{" "}
                <span data-testid="cost-confirm-amount">
                  ${estimatedUsd().toFixed(2)}
                </span>
                .
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowCostConfirm(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  data-testid="cost-confirm-proceed"
                  onClick={() => {
                    setForceWindow(true);
                    setShowCostConfirm(false);
                    void handleRun(true);
                  }}
                >
                  Run anyway
                </Button>
              </div>
            </div>
          </div>
        ) : null}

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
  );
}
