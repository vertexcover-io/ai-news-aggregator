import type { ReactElement } from "react";

export interface AbItem {
  rank: number;
  rawItemId: number;
  title: string;
  source: string;
  url: string;
}

export interface ABResultsPanelProps {
  saved: readonly AbItem[];
  draft: readonly AbItem[];
}

function Column({
  label,
  items,
  testid,
}: {
  label: string;
  items: readonly AbItem[];
  testid: string;
}): ReactElement {
  return (
    <div className="flex-1" data-testid={testid}>
      <div className="mb-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
        {label}
      </div>
      <ol className="space-y-2">
        {items.length === 0 ? (
          <li className="text-sm text-neutral-500">No items.</li>
        ) : (
          items.map((it) => (
            <li
              key={it.rank}
              className="rounded border border-neutral-200 bg-white p-2"
              data-testid="ab-item"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-neutral-400">
                  #{it.rank}
                </span>
                <a
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {it.title}
                </a>
              </div>
              <div className="font-mono text-xs text-neutral-500">
                {it.source}
              </div>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

export function ABResultsPanel({
  saved,
  draft,
}: ABResultsPanelProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <Column label="Saved prompt — top 10" items={saved} testid="ab-saved" />
      <Column label="Draft prompt — top 10" items={draft} testid="ab-draft" />
    </div>
  );
}
