import type { ReactElement } from "react";

export interface GradeProgressRingProps {
  labeled: number;
  total: number;
  must: number;
  nice: number;
  drop: number;
}

const RUST = "#8c3a1e";
const TIER_COLORS = {
  must: "#166534",
  nice: "#92400e",
  drop: "#57534e",
} as const;

interface TierBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

function TierBar({ label, count, total, color }: TierBarProps): ReactElement {
  const pct = total === 0 ? 0 : (count / total) * 100;
  return (
    <div className="grid grid-cols-[48px_1fr_28px] items-center gap-3 font-mono text-[11px]">
      <span className="uppercase tracking-[0.1em] text-stone-500">{label}</span>
      <span className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
        <span
          className="block h-full rounded-full"
          style={{ width: `${String(pct)}%`, background: color }}
        />
      </span>
      <span className="text-right tabular-nums text-stone-900">
        {String(count)}
      </span>
    </div>
  );
}

export function GradeProgressRing(
  props: GradeProgressRingProps,
): ReactElement {
  const { labeled, total, must, nice, drop } = props;
  const pct = total === 0 ? 0 : (labeled / total) * 100;
  const pctDisplay = Math.round(pct);
  const remaining = Math.max(total - labeled, 0);

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 border-b border-stone-200">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-900">
          Progress
        </span>
        <span className="font-mono text-[11px] text-stone-500">
          {String(labeled)} of {String(total)}
        </span>
      </header>

      <div
        className="w-[140px] h-[140px] rounded-full mx-auto my-3 flex items-center justify-center"
        style={{
          background: `conic-gradient(${RUST} 0deg, ${RUST} ${String(
            pct * 3.6,
          )}deg, #e7e5e4 ${String(pct * 3.6)}deg, #e7e5e4 360deg)`,
        }}
      >
        <div className="w-[116px] h-[116px] rounded-full bg-white flex flex-col items-center justify-center">
          <span className="font-mono text-[28px] font-medium text-stone-900 leading-none tabular-nums">
            {String(pctDisplay)}
            <span className="text-[14px] text-stone-500">%</span>
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500 mt-1"
            data-testid="progress-counter"
          >
            {String(remaining)} to go
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3">
        <TierBar
          label="Must"
          count={must}
          total={total}
          color={TIER_COLORS.must}
        />
        <TierBar
          label="Nice"
          count={nice}
          total={total}
          color={TIER_COLORS.nice}
        />
        <TierBar
          label="Drop"
          count={drop}
          total={total}
          color={TIER_COLORS.drop}
        />
      </div>
    </div>
  );
}
