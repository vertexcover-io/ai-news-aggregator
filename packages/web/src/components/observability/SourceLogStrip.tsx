import type { ReactElement } from "react";
import type { RunLogEntry, RunLogLevel } from "@newsletter/shared/types";

interface SourceLogStripProps {
  sourceName: string;
  logs: RunLogEntry[];
}

const LEVEL_CLASS: Record<RunLogLevel, string> = {
  debug: "text-mute-2",
  info: "text-mute",
  warn: "text-[#9a7b1f]",
  error: "text-[#9d2f22]",
};

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatContext(context: RunLogEntry["context"]): string {
  if (context === null) return "";
  return Object.entries(context)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}=${value.join(",")}`;
      if (typeof value === "object" && value !== null) {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(" · ");
}

export function SourceLogStrip({
  sourceName,
  logs,
}: SourceLogStripProps): ReactElement {
  return (
    <div className="mt-[18px] overflow-hidden rounded-[2px] border border-line bg-cream-elev">
      <div className="border-b border-line bg-[#f6f3ec] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-mute-2">
        Source log · {sourceName}
      </div>
      <div
        data-testid="source-log-strip"
        className="scrollbar-none max-h-44 overflow-y-auto"
      >
        {logs.length === 0 ? (
          <div className="px-3 py-3 font-mono text-[11px] text-mute">
            No source log lines recorded.
          </div>
        ) : (
          logs.map((log) => {
            const context = formatContext(log.context);
            return (
              <div
                key={log.id}
                data-level={log.level}
                className="grid grid-cols-[64px_70px_1fr] gap-2.5 border-t border-line px-3 py-1.5 font-mono text-[11px] leading-5 text-ink-2 first:border-t-0"
              >
                <span className="text-mute-2">{formatTime(log.ts)}</span>
                <span
                  className={`pt-px text-[9.5px] uppercase tracking-[0.06em] ${LEVEL_CLASS[log.level]}`}
                >
                  {log.level}
                </span>
                <span>
                  <b className="font-medium text-ink">{log.event}</b>{" "}
                  <span className="text-mute">
                    {log.message}
                    {context ? ` · ${context}` : ""}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
