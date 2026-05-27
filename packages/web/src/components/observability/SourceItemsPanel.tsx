import type { ReactElement } from "react";
import type {
  RunObservabilitySource,
  RunSourceItemsSummary,
} from "@newsletter/shared/types";
import { useRunSourceItems } from "../../hooks/useRunSourceItems";
import { SourceItemRow } from "./SourceItemRow";
import { SourceLogStrip } from "./SourceLogStrip";

interface SourceItemsPanelProps {
  runId: string;
  source: RunObservabilitySource;
  sourceKey: string;
}

interface Pill {
  label: string;
  value: number;
  tone?: "ranked" | "shortlisted" | "dropped";
}

function pillClass(tone: Pill["tone"]): string {
  if (tone === "ranked") return "border-[#cfe0d0] text-[#3f7d4f]";
  if (tone === "shortlisted") return "border-[#d9d4c4] text-ink-2";
  if (tone === "dropped") return "border-[#e6cfc9] text-[#9d2f22]";
  return "border-line-strong text-mute";
}

function OutcomeSummaryPills({
  summary,
}: {
  summary: RunSourceItemsSummary;
}): ReactElement {
  const allPills: Pill[] = [
    { label: "ranked", value: summary.ranked, tone: "ranked" },
    { label: "shortlisted", value: summary.shortlisted, tone: "shortlisted" },
    { label: "deduped-survivors", value: summary.dedupedSurvivors },
    { label: "dedup-dropped", value: summary.dedupDropped, tone: "dropped" },
    { label: "enrich-failed", value: summary.enrichFailed, tone: "dropped" },
  ];
  const pills = allPills.filter((pill) => {
    if (pill.label === "ranked" || pill.label === "shortlisted") {
      return pill.value > 0;
    }
    return true;
  });

  return (
    <div className="flex flex-wrap gap-1.5 py-3.5">
      {pills.map((pill) => (
        <span
          key={pill.label}
          className={`rounded-full border bg-cream-elev px-[9px] py-[3px] font-mono text-[10px] uppercase tracking-[0.06em] ${pillClass(pill.tone)}`}
        >
          <b className="font-semibold text-ink">{pill.value}</b> {pill.label}
        </span>
      ))}
    </div>
  );
}

export function SourceItemsPanel({
  runId,
  source,
  sourceKey,
}: SourceItemsPanelProps): ReactElement {
  const query = useRunSourceItems(runId, sourceKey, true);

  if (query.isLoading || query.data === undefined) {
    return (
      <div
        data-testid="source-items-panel"
        className="border-b border-line bg-[#faf7f0] py-4 pr-3 pl-8 font-mono text-[12px] text-mute"
      >
        Loading source items...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div
        data-testid="source-items-panel"
        className="border-b border-line bg-[#faf7f0] py-4 pr-3 pl-8 font-mono text-[12px] text-[#9d2f22]"
      >
        Failed to load source items.
      </div>
    );
  }

  const data = query.data;
  const showLogOnly = source.status === "failed" && data.items.length === 0;

  return (
    <div
      data-testid="source-items-panel"
      className="border-b border-line bg-[#faf7f0] py-1 pr-3 pb-4 pl-8"
    >
      {showLogOnly ? (
        <div className="py-3.5 pb-0 font-mono text-[10px] leading-[1.45] text-[#9d2f22]">
          Source failed — no items collected, so there is no per-item list to show.
          Collector log below.
        </div>
      ) : (
        <>
          <OutcomeSummaryPills summary={data.summary} />
          {data.items.length === 0 ? (
            <div className="border-t border-line-strong py-4 font-mono text-[11px] text-mute">
              No items collected for this source.
            </div>
          ) : (
            <div
              data-testid="source-item-list"
              className="scrollbar-none max-h-[28rem] overflow-y-auto"
            >
              {data.items.map((item) => (
                <SourceItemRow key={item.id} item={item} live={data.live} />
              ))}
            </div>
          )}
        </>
      )}
      <SourceLogStrip sourceName={source.displayName} logs={data.logs} />
    </div>
  );
}
