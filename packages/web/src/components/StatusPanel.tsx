import type { ReactElement } from "react";
import type { SourceRunState, SourceStatus } from "@newsletter/shared";
import type { RunStateResponse } from "../api/runs";

interface StatusPanelProps {
  state: RunStateResponse;
}

const STATUS_COLORS: Record<SourceStatus, string> = {
  pending: "bg-gray-200 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

interface SourceRow {
  name: string;
  source: SourceRunState;
}

export function StatusPanel({ state }: StatusPanelProps): ReactElement {
  const rows: SourceRow[] = [];
  if (state.sources.hn) rows.push({ name: "HN", source: state.sources.hn });
  if (state.sources.reddit)
    rows.push({ name: "Reddit", source: state.sources.reddit });
  if (state.sources.blog)
    rows.push({ name: "Blog", source: state.sources.blog });

  return (
    <div className="border border-gray-200 rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Run {state.id.slice(0, 8)}</h2>
        <span className="text-sm text-gray-600">
          stage: {state.stage} · status: {state.status}
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-3 text-sm">
            <span className="w-20 font-medium">{row.name}</span>
            <span
              className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[row.source.status]}`}
            >
              {row.source.status}
            </span>
            <span className="text-gray-600">
              {row.source.itemsFetched} items
            </span>
            {row.source.errors.length > 0 && (
              <span className="text-red-600">
                {row.source.errors.length} errors
              </span>
            )}
          </li>
        ))}
      </ul>
      {state.error && (
        <p className="text-sm text-red-600">Error: {state.error}</p>
      )}
    </div>
  );
}
