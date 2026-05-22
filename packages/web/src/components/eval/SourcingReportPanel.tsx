import type { ReactElement } from "react";
import type { SourcingReportRow } from "@newsletter/shared/types/eval-ranking";

export interface SourcingReportPanelProps {
  rows: readonly SourcingReportRow[];
}

export function SourcingReportPanel({
  rows,
}: SourcingReportPanelProps): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <section
      data-testid="sourcing-report"
      className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
    >
      <header className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/60 px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-700">
          Sourcing report
        </span>
        <span className="font-mono text-[11px] text-neutral-500">
          where labels land per source
        </span>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left">
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Source
            </th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Distribution
            </th>
            <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Must
            </th>
            <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Nice
            </th>
            <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Drop
            </th>
            <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = r.mustIncludeCount + r.niceCount + r.dropCount;
            const pct = (n: number): number =>
              total === 0 ? 0 : (n / total) * 100;
            const mustPct = pct(r.mustIncludeCount);
            const nicePct = pct(r.niceCount);
            const dropPct = pct(r.dropCount);
            return (
              <tr
                key={r.sourceType}
                data-testid={`sourcing-row-${r.sourceType}`}
                className="border-b border-neutral-100 last:border-none"
              >
                <td className="px-5 py-3 font-mono text-xs text-neutral-900">
                  {r.sourceType}
                </td>
                <td className="px-5 py-3">
                  <span
                    className="flex h-2 w-[140px] overflow-hidden rounded-sm"
                    aria-hidden
                  >
                    <span
                      style={{ width: `${mustPct.toFixed(2)}%`, background: "#2f7a3a" }}
                    />
                    <span
                      style={{ width: `${nicePct.toFixed(2)}%`, background: "#b58a2c" }}
                    />
                    <span
                      style={{ width: `${dropPct.toFixed(2)}%`, background: "#8a8472" }}
                    />
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                  {r.mustIncludeCount}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                  {r.niceCount}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                  {r.dropCount}
                </td>
                <td className="px-5 py-3 text-right font-mono text-sm font-semibold tabular-nums">
                  {total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
