import type { ReactElement } from "react";
import type {
  EvalScore,
  PerFixtureCost,
} from "@newsletter/shared/types/eval-ranking";

export interface EvalProgressRow {
  fixtureId: string;
  status: "running" | "done" | "error";
  score?: EvalScore;
  cost?: PerFixtureCost;
  error?: string;
}

export interface EvalResultsPanelProps {
  rows: readonly EvalProgressRow[];
  totalUsd: number | null;
  running: boolean;
}

function fmtNumber(n: number, digits = 3): string {
  if (Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function EvalResultsPanel({
  rows,
  totalUsd,
  running,
}: EvalResultsPanelProps): ReactElement {
  const done = rows.filter((r) => r.status === "done" && r.score);
  const meanNdcg =
    done.length === 0
      ? null
      : done.reduce((acc, r) => acc + (r.score?.ndcgAt10 ?? 0), 0) /
        done.length;

  return (
    <div className="space-y-3">
      <div
        data-testid="eval-results-aggregate"
        className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">
            Aggregate
          </span>
          <span>
            Mean nDCG@10:{" "}
            <strong>{meanNdcg === null ? "—" : fmtNumber(meanNdcg)}</strong>
          </span>
          <span>
            Total cost:{" "}
            <strong>{totalUsd === null ? "—" : fmtUsd(totalUsd)}</strong>
          </span>
          <span className="text-neutral-500">
            {running ? "Running…" : `${String(rows.length)} fixture(s)`}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded border border-neutral-200">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100 text-left">
            <tr>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                Fixture
              </th>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                Status
              </th>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                nDCG@10
              </th>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                P@10
              </th>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                Recall
              </th>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                R1=must
              </th>
              <th className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-4 text-center text-neutral-500"
                >
                  No runs yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.fixtureId}
                  data-testid="eval-result-row"
                  data-fixture-id={r.fixtureId}
                  className="border-t border-neutral-200"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.fixtureId}</td>
                  <td className="px-3 py-2 text-xs">{r.status}</td>
                  <td className="px-3 py-2">
                    {r.score ? fmtNumber(r.score.ndcgAt10) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.score ? fmtNumber(r.score.precisionAt10) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.score ? fmtNumber(r.score.mustIncludeRecall) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.score ? (r.score.rankOneIsMustInclude ? "✓" : "✗") : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.cost ? (
                      <span>
                        {fmtUsd(r.cost.usd)}{" "}
                        {r.cost.cacheHit ? (
                          <span className="ml-1 rounded bg-emerald-100 px-1 text-emerald-800">
                            cache
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
