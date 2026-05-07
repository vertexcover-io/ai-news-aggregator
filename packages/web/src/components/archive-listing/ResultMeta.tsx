import type { ReactElement } from "react";

export interface ResultMetaProps {
  count: number;
  q: string;
  rangeLabel?: string;
}

export function ResultMeta({ count, q, rangeLabel }: ResultMetaProps): ReactElement {
  const noun = count === 1 ? "issue" : "issues";
  return (
    <p className="mt-6 font-mono text-xs uppercase tracking-widest text-neutral-600">
      <strong className="font-mono font-semibold text-neutral-900">
        {count} {noun}
      </strong>{" "}
      match {`"${q}"`}
      {rangeLabel ? <span> · {rangeLabel}</span> : null}
    </p>
  );
}
