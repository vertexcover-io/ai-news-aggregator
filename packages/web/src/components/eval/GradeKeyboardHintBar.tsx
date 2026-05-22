import type { ReactElement } from "react";

export interface GradeKeyboardHintBarProps {
  lastEditSecondsAgo: number | null;
}

function Kbd({ children }: { children: string }): ReactElement {
  return (
    <kbd className="inline-block min-w-[22px] h-[22px] leading-[20px] px-[6px] font-mono text-[11px] text-stone-900 bg-stone-50 border border-stone-300 border-b-2 rounded text-center">
      {children}
    </kbd>
  );
}

function Sep(): ReactElement {
  return <span className="w-px h-4 bg-stone-200" aria-hidden="true" />;
}

export function GradeKeyboardHintBar(
  props: GradeKeyboardHintBarProps,
): ReactElement {
  const { lastEditSecondsAgo } = props;
  const editLabel =
    lastEditSecondsAgo === null
      ? "no edits yet"
      : `last edit ${String(lastEditSecondsAgo)} s ago`;
  return (
    <div
      data-testid="grade-keybar"
      className="mb-5 bg-white border border-stone-200 rounded-md px-4 py-2 flex items-center gap-5 font-mono text-[11px] text-stone-500"
    >
      <span className="inline-flex items-center gap-2">
        <Kbd>1</Kbd> must
      </span>
      <span className="inline-flex items-center gap-2">
        <Kbd>2</Kbd> nice
      </span>
      <span className="inline-flex items-center gap-2">
        <Kbd>3</Kbd> drop
      </span>
      <Sep />
      <span className="inline-flex items-center gap-2">
        <Kbd>Space</Kbd> expand
      </span>
      <Sep />
      <span className="inline-flex items-center gap-2">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> navigate
      </span>
      <Sep />
      <span className="ml-auto">autosave on · {editLabel}</span>
    </div>
  );
}
