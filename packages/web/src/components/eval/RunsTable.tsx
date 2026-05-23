import type { ReactElement } from "react";
import type { EvalRunSummary } from "@newsletter/shared/types/eval-ranking";

export interface RunsTableProps {
  runs: readonly EvalRunSummary[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onRowClick: (id: string) => void;
  onHashClick: (id: string) => void;
}

function shortId(id: string): string {
  return `r/${id.slice(0, 6)}`;
}

function shortHash(hash: string | null): string {
  if (hash === null) return "—";
  return hash.slice(0, 8);
}

function formatTimestamp(iso: string): string {
  // Mock format: 2026-05-21 19:14:08
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Read a value from a nested unknown via a dot path. Returns undefined on any
 * type mismatch along the way. Kept narrow on purpose — these jsonb columns
 * are typed `unknown` at the API boundary and we only ever pluck a couple of
 * leaf numbers out of them.
 */
function pickNumber(value: unknown, path: readonly string[]): number | null {
  let cur: unknown = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur === "number" && Number.isFinite(cur)) return cur;
  return null;
}

// Score breakdown shape (Mode A): { aggregate: { meanNdcgAt10 }, perFixture: [...] }
// Score breakdown shape (Mode B): { saved, draft } — no nDCG axis.
// Cost breakdown shape: { totalUsd, perFixture?: [...] | saved?, draft? }
// Sources of truth: packages/api/src/routes/admin-eval.ts (persist* helpers),
// docs/spec/eval-runs-persistence-collectors/spec.md REQ-3.
function formatScore(breakdown: unknown): string {
  const v = pickNumber(breakdown, ["aggregate", "meanNdcgAt10"]);
  if (v === null) return "—";
  return v.toFixed(3);
}

function formatCost(breakdown: unknown): string {
  const v = pickNumber(breakdown, ["totalUsd"]);
  if (v === null) return "—";
  return `$${v.toFixed(3)}`;
}

interface StatusProps {
  status: EvalRunSummary["status"];
}

function StatusCell({ status }: StatusProps): ReactElement {
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

function modeLabel(mode: EvalRunSummary["mode"]): string {
  return mode === "scored" ? "Mode A" : "Mode B";
}

function scopeLabel(run: EvalRunSummary): string {
  if (run.fixtureId !== null && run.fixtureId.length > 0) return run.fixtureId;
  if (run.date !== null && run.date.length > 0) return `date · ${run.date}`;
  if (run.windowSize !== null) return `top-${String(run.windowSize)}`;
  return "—";
}

export function RunsTable({
  runs,
  selectedIds,
  onToggleSelect,
  onRowClick,
  onHashClick,
}: RunsTableProps): ReactElement {
  return (
    <section
      className="rounded-t-lg border border-neutral-200 bg-white"
      data-testid="runs-table-section"
    >
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left font-mono text-[11px] uppercase tracking-wider text-neutral-500">
            <th className="w-10 px-3 py-2.5" />
            <th className="px-3 py-2.5">Run</th>
            <th className="px-3 py-2.5">Started</th>
            <th className="w-24 px-3 py-2.5">Mode</th>
            <th className="px-3 py-2.5">Fixture / scope</th>
            <th className="w-28 px-3 py-2.5">Prompt</th>
            <th className="w-24 px-3 py-2.5 text-right">nDCG@10</th>
            <th className="w-24 px-3 py-2.5 text-right">Cost</th>
            <th className="w-32 px-3 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody data-testid="runs-table-body">
          {runs.map((run) => {
            const checked = selectedIds.has(run.id);
            return (
              <tr
                key={run.id}
                data-testid={`runs-row-${run.id}`}
                data-selected={checked ? "true" : "false"}
                className={`border-b border-neutral-100 ${
                  checked ? "bg-[#fbf2ee]" : "hover:bg-neutral-50"
                }`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`select run ${run.id}`}
                    data-testid={`runs-row-checkbox-${run.id}`}
                    onChange={() => {
                      onToggleSelect(run.id);
                    }}
                    className="size-4 accent-[#8c3a1e]"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-neutral-800">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      onRowClick(run.id);
                    }}
                  >
                    {shortId(run.id)}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-500">
                  {formatTimestamp(run.startedAt)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      run.mode === "scored"
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-neutral-200 bg-neutral-50 text-neutral-600"
                    }`}
                  >
                    {modeLabel(run.mode)}
                  </span>
                </td>
                <td className="truncate px-3 py-2 font-mono text-xs text-neutral-700">
                  {scopeLabel(run)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      onHashClick(run.id);
                    }}
                    className="border-b border-dotted border-neutral-300 text-[#8c3a1e] hover:border-[#8c3a1e]"
                  >
                    {shortHash(run.draftPromptHash)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[13px] font-medium tabular-nums text-neutral-800">
                  {formatScore(run.scoreBreakdown)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-neutral-500">
                  {formatCost(run.costBreakdown)}
                </td>
                <td className="px-3 py-2">
                  <StatusCell status={run.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
