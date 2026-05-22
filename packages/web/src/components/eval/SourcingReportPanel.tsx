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
    <div
      data-testid="sourcing-report"
      className="rounded border border-neutral-200 bg-white p-3"
    >
      <div className="mb-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
        Sourcing report
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
            <th className="py-1 pr-2 font-normal">Source</th>
            <th className="py-1 px-2 text-right font-normal">Must</th>
            <th className="py-1 px-2 text-right font-normal">Nice</th>
            <th className="py-1 px-2 text-right font-normal">Drop</th>
            <th className="py-1 pl-2 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = r.mustIncludeCount + r.niceCount + r.dropCount;
            return (
              <tr
                key={r.sourceType}
                data-testid={`sourcing-row-${r.sourceType}`}
                className="border-b border-neutral-100 last:border-none"
              >
                <td className="py-1 pr-2 font-mono text-xs">{r.sourceType}</td>
                <td className="py-1 px-2 text-right">{r.mustIncludeCount}</td>
                <td className="py-1 px-2 text-right">{r.niceCount}</td>
                <td className="py-1 px-2 text-right">{r.dropCount}</td>
                <td className="py-1 pl-2 text-right">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
