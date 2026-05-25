import { Fragment, type ReactElement } from "react";
import type { RunFunnel as RunFunnelData } from "@newsletter/shared/types";
import { formatCount } from "./format";

interface RunFunnelProps {
  funnel: RunFunnelData;
  topN: number | null;
}

interface FunnelRow {
  key: string;
  label: string;
  stage: string;
  value: number | null;
  barClass: string;
}

function dropAnnotation(
  from: number | null,
  to: number | null,
): { removed: number; pct: number } | null {
  if (from === null || to === null) return null;
  if (from <= 0) return null;
  const removed = from - to;
  if (removed <= 0) return null;
  return { removed, pct: (removed / from) * 100 };
}

export function RunFunnel({ funnel, topN }: RunFunnelProps): ReactElement {
  const rows: FunnelRow[] = [
    {
      key: "collected",
      label: "Collected",
      stage: "collect",
      value: funnel.collected,
      barClass: "bg-ink",
    },
    {
      key: "deduped",
      label: "Deduped",
      stage: "process",
      value: funnel.deduped,
      barClass: "bg-ink-2",
    },
    {
      key: "shortlisted",
      label: "Shortlisted",
      stage: "shortlist",
      value: funnel.shortlisted,
      barClass: "bg-rust-deep",
    },
    {
      key: "rank",
      label: "Ranked",
      stage: "rank",
      value: funnel.ranked,
      barClass: "bg-rust",
    },
  ];

  const max = funnel.collected ?? 0;

  const drops = [
    dropAnnotation(funnel.collected, funnel.deduped),
    dropAnnotation(funnel.deduped, funnel.shortlisted),
    dropAnnotation(funnel.shortlisted, funnel.ranked),
  ];
  const dropNouns = [
    "duplicates removed",
    "below shortlist cut",
    "not surfaced",
  ];

  return (
    <div data-testid="run-funnel" className="py-1">
      {rows.map((row, i) => {
        const isPending = row.value === null;
        const widthPct =
          isPending || max <= 0
            ? 9
            : Math.max(4, Math.round(((row.value ?? 0) / max) * 100));
        const numText =
          row.label === "Ranked" && isPending
            ? `— / ${topN === null ? "?" : String(topN)}`
            : formatCount(row.value);

        const drop = i < drops.length ? drops[i] : null;
        return (
          <Fragment key={row.key}>
            <div
              data-testid={`funnel-row-${row.key}`}
              data-pending={isPending ? "true" : "false"}
              className="grid grid-cols-[118px_1fr_86px] items-center gap-3.5 border-b border-dashed border-line py-3 last:border-b-0"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
                {row.label}
                <span className="mt-0.5 block text-[9.5px] tracking-[0.14em] text-mute-2">
                  {row.stage}
                </span>
              </div>
              <div
                data-testid={`funnel-bar-${row.key}`}
                className={
                  isPending
                    ? "h-[26px] rounded-[2px] bg-[repeating-linear-gradient(45deg,#efeadf,#efeadf_6px,#e7e2d6_6px,#e7e2d6_12px)]"
                    : `h-[26px] rounded-[2px] ${row.barClass}`
                }
                style={{ width: `${String(widthPct)}%` }}
              />
              <div
                className={
                  isPending
                    ? "text-right font-mono text-sm text-mute-2"
                    : "text-right font-mono text-xl font-medium text-ink"
                }
              >
                {numText}
              </div>
            </div>
            {drop !== null ? (
              <div className="-mt-1.5 pl-[132px] font-mono text-[10px] text-mute-2">
                ↓ <b className="text-[#9d2f22]">−{formatCount(drop.removed)}</b>{" "}
                {dropNouns[i]} ({drop.pct.toFixed(1)}%)
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
