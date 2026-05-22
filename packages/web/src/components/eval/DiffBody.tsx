import type { ReactElement } from "react";
import { diffLines, type DiffLine } from "./PromptDiffModal";

export interface DiffBodyProps {
  left: string;
  right: string;
  maxHeightClass?: string;
}

export function DiffBody({
  left,
  right,
  maxHeightClass = "max-h-[60vh]",
}: DiffBodyProps): ReactElement {
  const lines: DiffLine[] = diffLines(left, right);
  return (
    <pre
      data-testid="diff-body"
      className={`${maxHeightClass} overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100`}
    >
      {lines.map((l, idx) => {
        const prefix =
          l.type === "add" ? "+ " : l.type === "remove" ? "- " : "  ";
        const cls =
          l.type === "add"
            ? "bg-emerald-900/40 text-emerald-200"
            : l.type === "remove"
              ? "bg-rose-900/40 text-rose-200"
              : "text-neutral-400";
        return (
          <div key={idx} data-difftype={l.type} className={cls}>
            {prefix}
            {l.text}
          </div>
        );
      })}
    </pre>
  );
}

export function countDiff(left: string, right: string): {
  added: number;
  removed: number;
} {
  const lines = diffLines(left, right);
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "remove").length,
  };
}
