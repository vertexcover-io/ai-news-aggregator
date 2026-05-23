import { type ReactElement } from "react";
import { useQueries } from "@tanstack/react-query";
import type { EvalRun } from "@newsletter/shared/types/eval-ranking";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getEvalRun, EvalApiError } from "../../api/eval";
import { DiffBody, countDiff } from "./DiffBody";

export interface ComparePromptsDialogProps {
  runIds: readonly [string, string] | null;
  onClose: () => void;
}

function shortId(id: string): string {
  return `r/${id.slice(0, 6)}`;
}

function formatNdcg(breakdown: unknown): number | null {
  if (
    breakdown !== null &&
    typeof breakdown === "object" &&
    "ndcgAt10" in breakdown
  ) {
    const v = (breakdown as { ndcgAt10?: unknown }).ndcgAt10;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

interface ScoreDeltaRowProps {
  left: EvalRun | undefined;
  right: EvalRun | undefined;
}

function ScoreDeltaRow({ left, right }: ScoreDeltaRowProps): ReactElement {
  const lScore = left ? formatNdcg(left.scoreBreakdown) : null;
  const rScore = right ? formatNdcg(right.scoreBreakdown) : null;
  const fmt = (n: number | null): string => (n === null ? "—" : n.toFixed(3));
  const delta = lScore !== null && rScore !== null ? rScore - lScore : null;
  const deltaStr =
    delta === null
      ? ""
      : ` (${delta >= 0 ? "+" : ""}${delta.toFixed(3)})`;
  return (
    <div
      data-testid="compare-score-delta"
      className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-4 py-3 font-mono text-xs"
    >
      <span className="uppercase tracking-wider text-neutral-500">
        nDCG@10
      </span>
      <span className="tabular-nums text-neutral-800">
        {fmt(lScore)} → {fmt(rScore)}
        <span
          className={
            delta === null
              ? "text-neutral-400"
              : delta >= 0
                ? "text-emerald-700"
                : "text-rose-700"
          }
        >
          {deltaStr}
        </span>
      </span>
    </div>
  );
}

export function ComparePromptsDialog({
  runIds,
  onClose,
}: ComparePromptsDialogProps): ReactElement {
  const open = runIds !== null;
  const [idA, idB] = runIds ?? ["", ""];

  const results = useQueries({
    queries: [
      {
        queryKey: ["eval-run", idA],
        queryFn: () => getEvalRun(idA),
        enabled: open && idA !== "",
      },
      {
        queryKey: ["eval-run", idB],
        queryFn: () => getEvalRun(idB),
        enabled: open && idB !== "",
      },
    ],
  });

  const [qA, qB] = results;
  const runA = qA.data;
  const runB = qB.data;
  const errA = qA.error as EvalApiError | null;
  const errB = qB.error as EvalApiError | null;

  const isLoading =
    open && (qA.isLoading || qB.isLoading) && runA === undefined && runB === undefined;

  const identical =
    runA !== undefined &&
    runA.draftPromptHash === runB?.draftPromptHash;

  const diff =
    runA !== undefined && runB !== undefined
      ? countDiff(runA.draftPromptSnapshot, runB.draftPromptSnapshot)
      : { added: 0, removed: 0 };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="compare-prompts-dialog"
        className="!max-w-[1200px] gap-0 p-0"
        style={{ width: "min(1200px, calc(100vw - 2rem))" }}
      >
        <DialogTitle className="sr-only">Compare prompts</DialogTitle>
        <DialogDescription className="sr-only">
          Side-by-side prompt diff between two eval runs
        </DialogDescription>

        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-lg text-neutral-900">
              Compare prompts
            </h2>
            {runIds !== null ? (
              <span className="font-mono text-xs text-neutral-500">
                {shortId(runIds[0])} ←→ {shortId(runIds[1])}
              </span>
            ) : null}
          </div>
          {runA !== undefined && runB !== undefined ? (
            <span className="font-mono text-xs text-neutral-500">
              <span className="text-emerald-700">+{String(diff.added)}</span> /{" "}
              <span className="text-rose-700">−{String(diff.removed)}</span>
            </span>
          ) : null}
        </header>

        {errA !== null || errB !== null ? (
          <div
            data-testid="compare-error-banner"
            className="m-4 rounded border border-rose-200 bg-rose-50 p-3"
          >
            <div className="font-mono text-[11px] uppercase tracking-wider text-rose-700">
              {errA && errB
                ? "Both runs failed to load"
                : errA
                  ? `Left side (${shortId(idA)}) failed to load`
                  : `Right side (${shortId(idB)}) failed to load`}
            </div>
            <p className="mt-1 font-mono text-xs text-rose-900">
              {(errA?.message ?? errB?.message) ?? "Unknown error"}
            </p>
          </div>
        ) : null}

        <div className="p-4">
          {isLoading ? (
            <div
              data-testid="compare-loading"
              className="py-12 text-center font-mono text-xs uppercase tracking-wider text-neutral-500"
            >
              Loading…
            </div>
          ) : identical ? (
            <div
              data-testid="compare-no-changes"
              className="rounded border border-neutral-200 bg-neutral-50 px-4 py-6 text-center font-mono text-xs text-neutral-600"
            >
              No changes — both runs used the same prompt
            </div>
          ) : runA !== undefined && runB !== undefined ? (
            <DiffBody
              left={runA.draftPromptSnapshot}
              right={runB.draftPromptSnapshot}
            />
          ) : runA !== undefined ? (
            <pre
              data-testid="compare-snapshot-a"
              className="max-h-[60vh] overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs text-neutral-100"
            >
              {runA.draftPromptSnapshot}
            </pre>
          ) : runB !== undefined ? (
            <pre
              data-testid="compare-snapshot-b"
              className="max-h-[60vh] overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs text-neutral-100"
            >
              {runB.draftPromptSnapshot}
            </pre>
          ) : null}
        </div>

        <ScoreDeltaRow left={runA} right={runB} />
      </DialogContent>
    </Dialog>
  );
}
