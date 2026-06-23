import type { ReactElement } from "react";
import type {
  RunLogEntry,
  RunLogLevel,
  SourceStepKey,
} from "@newsletter/shared/types";

interface SourceLogStripProps {
  sourceName: string;
  logs: RunLogEntry[];
  /** When set, only logs resolved to this step are shown. */
  selectedStep?: SourceStepKey | null;
}

const LEVEL_CLASS: Record<RunLogLevel, string> = {
  debug: "text-mute-2",
  info: "text-mute",
  warn: "text-[#9a7b1f]",
  error: "text-[#9d2f22]",
};

const RAIL_CLASS: Record<RunLogLevel, string> = {
  debug: "",
  info: "",
  warn: "border-l-2 border-[#9a6a16] pl-2.5",
  error: "border-l-2 border-[#9d2f22] bg-[#fdf4f1] pl-2.5",
};

// Keys already rendered elsewhere on the row; don't repeat them as chips.
const SKIP_CONTEXT_KEYS = new Set(["stack", "step"]);

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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(",");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

interface Chip {
  key: string;
  value: string;
  emphasis: boolean;
}

function contextChips(context: RunLogEntry["context"]): Chip[] {
  if (context === null) return [];
  const chips: Chip[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (SKIP_CONTEXT_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    const str = formatValue(value);
    if (str.length === 0) continue;
    const emphasis =
      key === "errorClass" ||
      key === "status" ||
      (key === "fatal" && value === true);
    chips.push({ key, value: str, emphasis });
  }
  return chips;
}

export function SourceLogStrip({
  sourceName,
  logs,
  selectedStep = null,
}: SourceLogStripProps): ReactElement {
  const visible =
    selectedStep === null
      ? logs
      : logs.filter((log) => log.context?.step === selectedStep);

  return (
    <div className="mt-[18px] overflow-hidden rounded-[2px] border border-line bg-cream-elev">
      <div className="flex items-center justify-between border-b border-line bg-[#f6f3ec] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-mute-2">
        <span>
          Source log · {sourceName}{" "}
          <span className="text-[#3f6f3a]">(this source only)</span>
          {selectedStep !== null ? (
            <span className="text-ink"> · step: {selectedStep}</span>
          ) : null}
        </span>
        <span>{visible.length} lines</span>
      </div>
      <div
        data-testid="source-log-strip"
        className="scrollbar-none max-h-60 overflow-y-auto"
      >
        {visible.length === 0 ? (
          <div className="px-3 py-3 font-mono text-[11px] text-mute">
            {selectedStep === null
              ? "No source log lines recorded."
              : `No log lines for the ${selectedStep} step.`}
          </div>
        ) : (
          visible.map((log) => {
            const chips = contextChips(log.context);
            return (
              <div
                key={log.id}
                data-level={log.level}
                className={`grid grid-cols-[64px_52px_1fr] gap-2.5 border-t border-line px-3 py-1.5 font-mono text-[11px] leading-5 text-ink-2 first:border-t-0 ${RAIL_CLASS[log.level]}`}
              >
                <span className="text-mute-2">{formatTime(log.ts)}</span>
                <span
                  className={`pt-px text-[8.5px] uppercase tracking-[0.06em] ${LEVEL_CLASS[log.level]}`}
                >
                  {log.level}
                </span>
                <span>
                  <b className="font-medium text-ink">{log.event}</b>{" "}
                  <span className="text-mute">{log.message}</span>
                  {chips.length > 0 ? (
                    <span className="mt-1 flex flex-wrap gap-x-1.5 gap-y-1">
                      {chips.map((chip) => (
                        <span
                          key={chip.key}
                          className={`rounded-[2px] border px-1.5 text-[9.5px] ${
                            chip.emphasis
                              ? "border-[#e3c8c2] bg-[#f7ebe8] text-[#9d2f22]"
                              : "border-line bg-chip text-ink-2"
                          }`}
                        >
                          <span className="text-mute-2">{chip.key}=</span>
                          {chip.value}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
