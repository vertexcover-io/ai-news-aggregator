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
import { PromptEditor } from "../components/eval/PromptEditor";
import { PromptDiffModal } from "../components/eval/PromptDiffModal";
import {
  EvalResultsPanel,
  type EvalProgressRow,
} from "../components/eval/EvalResultsPanel";
import {
  ABResultsPanel,
  type AbItem,
} from "../components/eval/ABResultsPanel";
import { SourcingReportPanel } from "../components/eval/SourcingReportPanel";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

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

  const fixtures = useMemo(
    () => fixturesQuery.data?.fixtures ?? [],
    [fixturesQuery.data],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 font-semibold min-h-[44px]"
        >
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Eval — prompt iteration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit the ranking prompt, run it against a graded fixture (Mode A)
            or a recent date (Mode B), then save when satisfied.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="lg:sticky lg:top-4 lg:self-start" data-testid="prompt-column">
            <PromptEditor
              value={draft}
              savedValue={savedPrompt}
              onChange={setDraft}
              onReset={() => {
                setDraft(savedPrompt);
              }}
              onSave={() => {
                setShowDiff(true);
              }}
            />
          </div>

          <div className="space-y-4" data-testid="run-column">
            <Tabs
              value={mode}
              onValueChange={(v) => {
                const next = v === "ab" ? "ab" : "scored";
                setMode(next);
                const params = new URLSearchParams(searchParams);
                if (next === "scored") params.delete("mode");
                else params.set("mode", next);
                setSearchParams(params, { replace: true });
              }}
            >
              <TabsList>
                <TabsTrigger value="scored">Mode A: Scored</TabsTrigger>
                <TabsTrigger value="ab">Mode B: Calendar</TabsTrigger>
              </TabsList>

              <TabsContent value="scored" className="space-y-3">
                <div className="space-y-3 rounded border border-neutral-200 bg-white p-3">
                  <fieldset
                    data-testid="scope-toggle"
                    className="flex gap-4 text-sm"
                  >
                    <label className="inline-flex items-center gap-1">
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
                    <label className="inline-flex items-center gap-1">
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
                      <span>Top-N most recent</span>
                    </label>
                  </fieldset>
                  <label className="block text-sm">
                    <span className="flex items-center justify-between font-mono text-xs uppercase tracking-widest text-neutral-500">
                      <span>Fixture</span>
                      <Link
                        to="/admin/eval/fixtures/new"
                        data-testid="new-fixture-link"
                        className="text-neutral-700 underline-offset-2 hover:underline normal-case tracking-normal"
                      >
                        + New fixture
                      </Link>
                    </span>
                    <select
                      data-testid="fixture-select"
                      className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
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
                  </label>
                  <label className="block text-sm">
                    <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">
                      Window size: {String(windowSize)}
                    </span>
                    <input
                      data-testid="window-slider"
                      type="range"
                      min={1}
                      max={60}
                      value={windowSize}
                      disabled={scoredScope !== "topN"}
                      onChange={(e) => {
                        setWindowSize(Number(e.target.value));
                      }}
                      className="mt-1 block w-full"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bypassCache}
                      onChange={(e) => {
                        setBypassCache(e.target.checked);
                      }}
                    />
                    <span>Bypass cache</span>
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
                    >
                      {running ? "Running…" : "Run"}
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
                {runError ? (
                  <div
                    data-testid="run-error"
                    className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
                  >
                    {runError}
                  </div>
                ) : null}
                <EvalResultsPanel
                  rows={rows}
                  totalUsd={totalUsd}
                  running={running}
                />
                <SourcingReportPanel rows={sourcing} />
              </TabsContent>

              <TabsContent value="ab" className="space-y-3">
                <div className="space-y-3 rounded border border-neutral-200 bg-white p-3">
                  <label className="block text-sm">
                    <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">
                      Date
                    </span>
                    <input
                      type="date"
                      data-testid="ab-date"
                      value={calendarDate}
                      max={formatTodayIso()}
                      onChange={(e) => {
                        setCalendarDate(e.target.value);
                      }}
                      className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
                    />
                  </label>
                  {!dirty ? (
                    <p
                      data-testid="ab-hint"
                      className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
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
                  >
                    {running ? "Running…" : "Run"}
                  </Button>
                </div>
                {runError ? (
                  <div
                    data-testid="run-error"
                    className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
                  >
                    {runError}
                  </div>
                ) : null}
                <ABResultsPanel saved={abSaved} draft={abDraft} />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {showCostConfirm ? (
          <div
            data-testid="cost-confirm-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-md rounded border border-neutral-200 bg-white p-4">
              <h2 className="text-lg font-semibold">Confirm large run</h2>
              <p className="mt-2 text-sm text-neutral-600">
                You are about to run {String(windowSize)} fixtures. Estimated
                cost: <span data-testid="cost-confirm-amount">${estimatedUsd().toFixed(2)}</span>.
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
