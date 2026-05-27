import type { ReactElement } from "react";
import type { RunSourceItem } from "@newsletter/shared/types";
import { LifecycleTrail } from "./LifecycleTrail";

interface SourceItemRowProps {
  item: RunSourceItem;
  live: boolean;
}

function formatRelativeTime(iso: string | null): string | null {
  if (iso === null) return null;
  const published = new Date(iso).getTime();
  if (Number.isNaN(published)) return null;
  const diffMs = Date.now() - published;
  const absMs = Math.max(0, diffMs);
  const hours = Math.floor(absMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

function metaLine(item: RunSourceItem): string {
  const bits = [
    item.author,
    `${item.engagement.points.toLocaleString("en-US")} pts`,
    `${item.engagement.commentCount.toLocaleString("en-US")} comments`,
    formatRelativeTime(item.publishedAt),
  ].filter((bit): bit is string => bit !== null && bit.length > 0);
  return bits.join(" · ");
}

export function SourceItemRow({ item, live }: SourceItemRowProps): ReactElement {
  const rank = item.lifecycle.rank;
  const rowReasonClass =
    item.furthestStage === "dedup-dropped" || item.furthestStage === "enrich-failed"
      ? "text-[#9d2f22]"
      : "text-mute";

  return (
    <div data-testid="source-item-row" className="border-t border-line py-[11px] first:border-line-strong">
      <div className="grid grid-cols-[26px_1fr_auto] items-start gap-3">
        <div
          className={`pt-0.5 font-mono text-[11px] ${
            rank !== null ? "font-medium text-rust" : "text-mute-2"
          }`}
        >
          {rank !== null ? `#${String(rank)}` : "-"}
        </div>
        <div>
          <a
            className="font-serif text-sm leading-[1.4] text-ink no-underline hover:text-rust hover:underline hover:underline-offset-2"
            href={item.url ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            {item.title} ↗
          </a>
          <div className="mt-0.5 font-mono text-[10px] tracking-[0.04em] text-mute-2">
            {metaLine(item)}
          </div>
          {item.dropReason ? (
            <div className={`mt-1 font-mono text-[10px] leading-[1.45] ${rowReasonClass}`}>
              {item.dropReason}
            </div>
          ) : null}
        </div>
        <LifecycleTrail item={item} live={live} />
      </div>
    </div>
  );
}
