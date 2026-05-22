import type { ReactElement } from "react";
import type { EvalProgressRow } from "./EvalResultsPanel";

export interface EvalAggregateHeroProps {
  rows: readonly EvalProgressRow[];
  totalUsd: number | null;
  running: boolean;
}

function fmt(n: number, digits = 3): string {
  if (Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export function EvalAggregateHero({
  rows,
  totalUsd,
  running,
}: EvalAggregateHeroProps): ReactElement {
  const done = rows.filter((r) => r.status === "done" && r.score);
  const meanNdcg =
    done.length === 0
      ? null
      : done.reduce((acc, r) => acc + (r.score?.ndcgAt10 ?? 0), 0) /
        done.length;
  const meanP10 =
    done.length === 0
      ? null
      : done.reduce((acc, r) => acc + (r.score?.precisionAt10 ?? 0), 0) /
        done.length;

  return (
    <section data-testid="eval-aggregate-hero">
      <div
        className="flex items-center gap-3 border border-b-0 border-neutral-200 px-5 py-2 font-mono text-[11px] uppercase tracking-wider"
        style={{
          background: running ? "rgba(140,58,30,0.06)" : "rgba(140,58,30,0.04)",
          color: "#8c3a1e",
          borderColor: "rgba(140,58,30,0.18)",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: "#8c3a1e" }}
        />
        {running
          ? "Running…"
          : `Mode A · completed · ${String(rows.length)} fixture${rows.length === 1 ? "" : "s"}`}
      </div>
      <div className="grid grid-cols-4 overflow-hidden rounded-b-lg border border-neutral-200 bg-white">
        <div className="border-r border-neutral-200 px-5 py-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
            nDCG@10 · mean
          </div>
          <div className="font-mono text-[28px] font-medium leading-none tabular-nums text-neutral-900">
            {meanNdcg === null ? "—" : fmt(meanNdcg)}
          </div>
        </div>
        <div className="border-r border-neutral-200 px-5 py-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
            Precision@10 · mean
          </div>
          <div className="font-mono text-[28px] font-medium leading-none tabular-nums text-neutral-900">
            {meanP10 === null ? "—" : fmt(meanP10)}
          </div>
        </div>
        <div className="border-r border-neutral-200 px-5 py-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
            Total cost
          </div>
          <div className="font-mono text-[28px] font-medium leading-none tabular-nums text-neutral-900">
            {totalUsd === null ? "—" : `$${totalUsd.toFixed(4)}`}
          </div>
        </div>
        <div className="px-5 py-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
            Fixtures · done
          </div>
          <div className="font-mono text-[28px] font-medium leading-none tabular-nums text-neutral-900">
            {String(done.length)}
            <span className="ml-1 text-sm text-neutral-500">
              / {String(rows.length)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
