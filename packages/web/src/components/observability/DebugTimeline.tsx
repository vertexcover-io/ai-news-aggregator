import { useState, type ReactElement } from "react";
import type { RunLogEntry, RunLogLevel } from "@newsletter/shared/types";
import { formatClock } from "./format";

interface DebugTimelineProps {
  logs: RunLogEntry[];
}

type LevelFilter = "all" | "info" | "warn" | "error";

const FILTERS: { key: LevelFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "info", label: "Info" },
  { key: "warn", label: "Warn" },
  { key: "error", label: "Error" },
];

const LEVEL_DOT: Record<RunLogLevel, string> = {
  debug: "bg-mute-2",
  info: "bg-mute-2",
  warn: "bg-[#9a6a16]",
  error: "bg-[#9d2f22]",
};

function matchesFilter(level: RunLogLevel, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "info") return level === "info" || level === "debug";
  return level === filter;
}

function LogRow({ entry }: { entry: RunLogEntry }): ReactElement {
  const [open, setOpen] = useState(false);
  const isError = entry.level === "error";
  const stack = typeof entry.context?.stack === "string" ? entry.context.stack : null;

  return (
    <div
      data-testid="log-row"
      data-level={entry.level}
      className={
        isError
          ? "grid grid-cols-[78px_16px_122px_1fr] items-baseline gap-3 border-b border-[#f1ede3] bg-[#f7ebe8] px-4 py-2.5 font-mono text-[12.5px] last:border-b-0"
          : "grid grid-cols-[78px_16px_122px_1fr] items-baseline gap-3 border-b border-[#f1ede3] px-4 py-2.5 font-mono text-[12.5px] last:border-b-0"
      }
    >
      <span className="text-[11px] text-mute-2">{formatClock(entry.ts)}</span>
      <span
        data-testid="log-level-dot"
        className={`mt-1.5 h-[7px] w-[7px] justify-self-center rounded-full ${LEVEL_DOT[entry.level]}`}
      />
      <span className="text-[11px] tracking-wide text-rust-deep">
        {entry.event}
      </span>
      <span className={isError ? "leading-relaxed text-[#9d2f22]" : "leading-relaxed text-ink-2"}>
        {entry.message}
        {stack !== null ? (
          <>
            <button
              type="button"
              data-testid="log-stack-toggle"
              onClick={() => {
                setOpen((v) => !v);
              }}
              className="ml-2 text-[11px] text-rust-deep underline"
            >
              {open ? "hide stack" : "stack"}
            </button>
            {open ? (
              <pre
                data-testid="log-stack"
                className="mt-1.5 overflow-x-auto whitespace-pre rounded-[3px] bg-ink-2 px-3 py-2.5 text-[11px] leading-relaxed text-[#e9e3d4]"
              >
                {stack}
              </pre>
            ) : null}
          </>
        ) : null}
      </span>
    </div>
  );
}

export function DebugTimeline({ logs }: DebugTimelineProps): ReactElement {
  const [filter, setFilter] = useState<LevelFilter>("all");

  const filtered = logs.filter((log) => matchesFilter(log.level, filter));

  return (
    <div data-testid="debug-timeline">
      <div className="mb-3 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            data-testid={`level-filter-${f.key}`}
            data-active={filter === f.key ? "true" : "false"}
            onClick={() => {
              setFilter(f.key);
            }}
            className={
              filter === f.key
                ? f.key === "error"
                  ? "rounded-full border border-[#9d2f22] bg-[#9d2f22] px-2.5 py-1 font-mono text-[11px] tracking-wide text-white"
                  : "rounded-full border border-ink bg-ink px-2.5 py-1 font-mono text-[11px] tracking-wide text-cream"
                : "rounded-full border border-line-strong bg-cream-elev px-2.5 py-1 font-mono text-[11px] tracking-wide text-mute"
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {logs.length === 0 ? (
        <div
          data-testid="timeline-empty"
          className="rounded border border-dashed border-line-strong bg-cream-elev p-6 text-center font-mono text-[12.5px] text-mute"
        >
          No debug logs recorded for this run.
        </div>
      ) : filtered.length === 0 ? (
        <div
          data-testid="timeline-filter-empty"
          className="rounded border border-dashed border-line-strong bg-cream-elev p-6 text-center font-mono text-[12.5px] text-mute"
        >
          No entries at this level.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-line bg-cream-elev">
          {filtered.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
