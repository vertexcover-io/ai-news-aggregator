import { useState, type ReactElement } from "react";
import type { RunLogEntry } from "@newsletter/shared/types";
import { formatClock } from "./format";

interface FailuresListProps {
  failures: RunLogEntry[];
}

const TRUNCATE_AT = 600;

/** First line of the message, NOT split on ':' — keeps the full error text. */
function titleLine(failure: RunLogEntry): string {
  const firstLine = failure.message.split("\n")[0].trim();
  if (firstLine.length > 0) {
    return firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine;
  }
  return failure.event;
}

interface CtxRow {
  key: string;
  label: string;
  value: string;
}

function stringify(value: unknown): string {
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function contextRows(failure: RunLogEntry): CtxRow[] {
  const ctx = failure.context;
  if (ctx === null) return [];
  const rows: CtxRow[] = [];
  const push = (key: string, label: string): void => {
    const value = ctx[key];
    if (value === undefined || value === null) return;
    const str = Array.isArray(value)
      ? value.map(stringify).join("; ")
      : stringify(value);
    if (str.length === 0) return;
    rows.push({ key, label, value: str });
  };
  push("errorClass", "error class");
  push("url", "url");
  push("endpoint", "endpoint");
  push("status", "http status");
  push("attempt", "attempt");
  push("retries", "retries");
  push("timeoutMs", "timeout (ms)");
  push("provider", "provider");
  push("errors", "errors");
  return rows;
}

function FailureCard({ failure }: { failure: RunLogEntry }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const ctx = failure.context;
  const fatal = ctx?.fatal === true;
  const isLong = failure.message.length > TRUNCATE_AT;
  const body =
    isLong && !expanded ? `${failure.message.slice(0, TRUNCATE_AT)}…` : failure.message;
  const rows = contextRows(failure);
  const step = typeof ctx?.step === "string" ? ctx.step : null;

  const tags: string[] = [];
  if (failure.source !== null) tags.push(`source: ${failure.source}`);
  if (typeof ctx?.errorClass === "string") tags.push(`class: ${ctx.errorClass}`);
  if (typeof ctx?.retries === "number") tags.push(`retries: ${String(ctx.retries)}`);
  tags.push(fatal ? "fatal" : "non-fatal");

  return (
    <div
      data-testid="failure-card"
      className={`border-b border-line px-5 py-4 last:border-b-0 ${
        fatal ? "border-l-[3px] border-l-[#9d2f22]" : "border-l-[3px] border-l-[#9a6a16]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div
          className={`font-serif text-[16px] font-semibold ${fatal ? "text-[#9d2f22]" : "text-[#9a6a16]"}`}
        >
          {titleLine(failure)}
        </div>
        <div className="shrink-0 font-mono text-[10.5px] text-mute">
          {formatClock(failure.ts)} · {failure.stage}
          {failure.source !== null ? ` · ${failure.source}` : ""}
          {step !== null ? ` · step: ${step}` : ""}
        </div>
      </div>
      <div className="mt-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-ink-2">
        {body}
      </div>
      {isLong ? (
        <button
          type="button"
          data-testid="failure-expand"
          onClick={() => {
            setExpanded((v) => !v);
          }}
          className="mt-1.5 font-mono text-[11px] text-rust-deep underline"
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-2.5 border-t border-dashed border-[#e3c8c2] pt-2.5">
          {rows.map((row) => (
            <div key={row.key} className="flex gap-2 font-mono text-[10.5px] leading-[1.7]">
              <span className="min-w-[88px] text-mute-2">{row.label}</span>
              <span className="break-all text-ink-2">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-[3px] border border-[#e3c8c2] bg-white px-2.5 py-0.5 font-mono text-[10.5px] tracking-wide text-rust-deep"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FailuresList({ failures }: FailuresListProps): ReactElement {
  if (failures.length === 0) {
    return (
      <div
        data-testid="failures-empty"
        className="rounded border border-dashed border-line-strong bg-cream-elev p-6 text-center font-mono text-[12.5px] text-mute"
      >
        No failures — every stage completed without error.
      </div>
    );
  }

  const sourceCount = new Set(
    failures.map((f) => f.source).filter((s): s is string => s !== null),
  ).size;

  return (
    <div
      data-testid="failures-list"
      className="overflow-hidden rounded border border-[#e3c8c2] bg-cream-elev"
    >
      <div className="flex items-center justify-between border-b border-[#e3c8c2] bg-[#f7ebe8] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9d2f22]">
        <span>
          ● {failures.length} {failures.length === 1 ? "failure" : "failures"}
          {sourceCount > 0
            ? ` across ${String(sourceCount)} ${sourceCount === 1 ? "source" : "sources"}`
            : ""}
        </span>
        <span className="text-mute-2">scroll ↓</span>
      </div>
      <div className="scrollbar-none max-h-[22rem] overflow-y-auto">
        {failures.map((failure) => (
          <FailureCard key={failure.id} failure={failure} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line bg-[#faf7f0] px-4 py-2 font-mono text-[10px] text-mute-2">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9d2f22] align-middle" />
          fatal — aborted this source
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9a6a16] align-middle" />
          non-fatal — degraded / partial
        </span>
      </div>
    </div>
  );
}
