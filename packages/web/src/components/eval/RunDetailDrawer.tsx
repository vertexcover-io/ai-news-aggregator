import { type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EvalRun } from "@newsletter/shared/types/eval-ranking";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getEvalRun, EvalApiError } from "../../api/eval";

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

function buildScoreRows(run: EvalRun): readonly BreakdownRow[] {
  const sb = run.scoreBreakdown;
  if (sb !== null && typeof sb === "object") {
    const obj = sb as Record<string, unknown>;
    if (run.mode === "scored") {
      return [
        { label: "nDCG@10", value: formatNum(obj.ndcgAt10) },
        { label: "nDCG@5", value: formatNum(obj.ndcgAt5) },
        { label: "Precision@10", value: formatNum(obj.precisionAt10) },
        { label: "Must-include recall", value: formatNum(obj.mustIncludeRecall) },
        {
          label: "Rank-1 = must",
          value:
            typeof obj.rankOneIsMustInclude === "boolean"
              ? obj.rankOneIsMustInclude
                ? "yes"
                : "no"
              : "—",
        },
        {
          label: "Headline · nDCG@10",
          value: formatNum(obj.ndcgAt10),
          total: true,
        },
      ];
    }
    const saved = Array.isArray(obj.saved) ? obj.saved.length : 0;
    const draft = Array.isArray(obj.draft) ? obj.draft.length : 0;
    return [
      { label: "Saved ranking", value: `${String(saved)} items` },
      { label: "Draft ranking", value: `${String(draft)} items` },
      { label: "Mode", value: "A/B comparison", total: true },
    ];
  }
  return [];
}

function buildCostRows(run: EvalRun): readonly BreakdownRow[] {
  const cb = run.costBreakdown;
  if (cb !== null && typeof cb === "object") {
    const obj = cb as Record<string, unknown>;
    const rows: BreakdownRow[] = [];
    if (obj.tokensIn !== undefined) {
      rows.push({
        label: "Rerank · input",
        value: formatTokens(obj.tokensIn),
        muted: true,
      });
    }
    if (obj.cacheWrite5m !== undefined) {
      rows.push({
        label: "cache write (5m)",
        value: formatTokens(obj.cacheWrite5m),
        sub: true,
      });
    }
    if (obj.cacheRead !== undefined) {
      rows.push({
        label: "cache read",
        value: formatTokens(obj.cacheRead),
        sub: true,
      });
    }
    if (obj.tokensOut !== undefined) {
      rows.push({
        label: "Rerank · output",
        value: formatTokens(obj.tokensOut),
        muted: true,
      });
    }
    const usd = obj.usd;
    rows.push({
      label: "Total cost",
      value:
        typeof usd === "number" && Number.isFinite(usd)
          ? `$${usd.toFixed(3)}`
          : "—",
      total: true,
    });
    return rows;
  }
  return [];
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

            <div
              className="grid h-[480px]"
              style={{ gridTemplateColumns: "1.4fr 1fr" }}
            >
              <div className="border-r border-neutral-200">
                <SnapshotPane
                  hash={run.draftPromptHash}
                  snapshot={run.draftPromptSnapshot}
                />
              </div>

              <div className="overflow-auto">
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
