import { useState, type ReactElement } from "react";
import type { RunLogEntry } from "@newsletter/shared/types";
import { formatClock } from "./format";

interface FailuresListProps {
  failures: RunLogEntry[];
}

const TRUNCATE_AT = 240;

function FailureCard({ failure }: { failure: RunLogEntry }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const ctx = failure.context;
  const title = failure.message.split("\n")[0]?.split(":")[0] ?? failure.event;
  const isLong = failure.message.length > TRUNCATE_AT;
  const body =
    isLong && !expanded
      ? `${failure.message.slice(0, TRUNCATE_AT)}…`
      : failure.message;

  const tags: string[] = [];
  if (failure.source !== null) tags.push(`source: ${failure.source}`);
  if (typeof ctx?.errorClass === "string") tags.push(`class: ${ctx.errorClass}`);
  if (typeof ctx?.retries === "number") tags.push(`retries: ${String(ctx.retries)}`);
  tags.push(ctx?.fatal === true ? "fatal" : "non-fatal");

  return (
    <div
      data-testid="failure-card"
      className="mb-3.5 rounded border border-l-4 border-[#9d2f22] bg-[#f7ebe8] px-5 py-4"
    >
      <div className="flex items-baseline justify-between">
        <div className="font-serif text-[17px] font-semibold text-[#9d2f22]">
          {title}
        </div>
        <div className="font-mono text-[11px] text-mute">
          {formatClock(failure.ts)} · stage: {failure.stage}
        </div>
      </div>
      <div className="mt-2 font-mono text-[12.5px] leading-relaxed text-ink-2">
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

  return (
    <div data-testid="failures-list">
      {failures.map((failure) => (
        <FailureCard key={failure.id} failure={failure} />
      ))}
    </div>
  );
}
