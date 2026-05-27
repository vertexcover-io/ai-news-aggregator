import { Fragment, useState, type KeyboardEvent, type ReactElement } from "react";
import type { RunObservabilitySource } from "@newsletter/shared/types";
import { formatDuration } from "./format";
import { SourceItemsPanel } from "./SourceItemsPanel";

interface SourceTelemetryTableProps {
  runId: string;
  sources: RunObservabilitySource[];
}

type SourceStatus = RunObservabilitySource["status"];

const BADGE_CLASS: Record<SourceStatus, string> = {
  completed: "bg-[#eef3ec] text-[#3f6f43]",
  partial: "bg-[#f7f0e0] text-[#9a6a16]",
  failed: "bg-[#f7ebe8] text-[#9d2f22]",
  running: "bg-[#fbf1ee] text-rust-deep",
  pending: "bg-chip text-mute",
};

const BADGE_LABEL: Record<SourceStatus, string> = {
  completed: "completed",
  partial: "partial",
  failed: "failed",
  running: "running",
  pending: "pending",
};

function StatusBadge({ status }: { status: SourceStatus }): ReactElement {
  return (
    <span
      data-testid={`source-badge-${status}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide ${BADGE_CLASS[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {BADGE_LABEL[status]}
    </span>
  );
}

export function SourceTelemetryTable({
  runId,
  sources,
}: SourceTelemetryTableProps): ReactElement {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (sources.length === 0) {
    return (
      <div
        data-testid="sources-empty"
        className="rounded border border-dashed border-line-strong bg-cream-elev p-6 text-center font-mono text-[12.5px] text-mute"
      >
        No source telemetry recorded for this run.
      </div>
    );
  }

  function sourceKey(source: RunObservabilitySource): string {
    return `${source.sourceType}:${source.identifier}`;
  }

  function toggleSource(source: RunObservabilitySource): void {
    const key = sourceKey(source);
    setExpandedKey((current) => (current === key ? null : key));
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    source: RunObservabilitySource,
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleSource(source);
    }
  }

  return (
    <table data-testid="source-telemetry-table" className="w-full border-collapse">
      <thead>
        <tr>
          <th className="border-b border-line-strong px-3 pb-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-mute-2">
            Source
          </th>
          <th className="border-b border-line-strong px-3 pb-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-mute-2">
            Status
          </th>
          <th className="border-b border-line-strong px-3 pb-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-mute-2">
            Items
          </th>
          <th className="border-b border-line-strong px-3 pb-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-mute-2">
            Retries
          </th>
          <th className="border-b border-line-strong px-3 pb-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-mute-2">
            Duration
          </th>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => {
          const key = sourceKey(source);
          const expanded = expandedKey === key;
          return (
            <Fragment key={key}>
              <tr
                data-testid={`source-row-${source.sourceType}`}
                aria-expanded={expanded}
                tabIndex={0}
                className={`cursor-pointer transition-colors hover:bg-[#f6f3ec] ${
                  expanded ? "bg-[#f4f0e7]" : ""
                }`}
                onClick={() => {
                  toggleSource(source);
                }}
                onKeyDown={(event) => {
                  handleRowKeyDown(event, source);
                }}
              >
                <td className="border-b border-line px-3 py-3 align-top font-mono text-[13px] text-ink-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-baseline gap-2 text-[13.5px] text-ink">
                      <span
                        aria-hidden="true"
                        className={`inline-block w-3 font-mono text-[11px] text-mute-2 transition-transform ${
                          expanded ? "rotate-90 text-rust" : ""
                        }`}
                      >
                        ▸
                      </span>
                      <span>{source.displayName}</span>
                    </span>
                    <span className="ml-5 text-[10px] uppercase tracking-[0.1em] text-mute-2">
                      {source.sourceType}
                    </span>
                  </div>
                  {source.status === "failed" && source.errors.length > 0 ? (
                    <div
                      data-testid={`source-error-${source.sourceType}`}
                      className="mt-1.5 ml-5 max-w-[340px] text-[11.5px] leading-snug text-[#9d2f22]"
                    >
                      {source.errors.join(" · ")}
                    </div>
                  ) : null}
                </td>
                <td className="border-b border-line px-3 py-3 align-top">
                  <StatusBadge status={source.status} />
                </td>
                <td className="border-b border-line px-3 py-3 text-right align-top font-mono text-[13px] text-ink-2">
                  {source.itemsFetched.toLocaleString("en-US")}
                </td>
                <td className="border-b border-line px-3 py-3 text-right align-top font-mono text-[13px] text-ink-2">
                  {source.retries}
                </td>
                <td className="border-b border-line px-3 py-3 text-right align-top font-mono text-[13px] text-ink-2">
                  {source.status === "running"
                    ? "— live"
                    : formatDuration(source.durationMs)}
                </td>
              </tr>
              {expanded ? (
                <tr data-testid={`source-panel-row-${source.sourceType}`}>
                  <td colSpan={5} className="p-0">
                    <SourceItemsPanel runId={runId} source={source} sourceKey={key} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
