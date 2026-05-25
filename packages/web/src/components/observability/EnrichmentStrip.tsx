import type { ReactElement } from "react";
import type { EnrichmentTelemetry } from "@newsletter/shared/types";

interface EnrichmentStripProps {
  enrichment: EnrichmentTelemetry | null;
}

const ZERO: EnrichmentTelemetry = {
  attempted: 0,
  ok: 0,
  failed: 0,
  skipped: 0,
  cacheHits: 0,
  avgFetchMs: 0,
  skippedReasons: {},
};

export function EnrichmentStrip({
  enrichment,
}: EnrichmentStripProps): ReactElement {
  const e = enrichment ?? ZERO;
  const skipReasons = Object.entries(e.skippedReasons).filter(
    ([, count]) => typeof count === "number" && count > 0,
  );

  return (
    <div data-testid="enrichment-strip">
      <div className="grid grid-cols-2 overflow-hidden rounded border border-line bg-cream-elev sm:grid-cols-5">
        <div className="border-r border-line px-3.5 py-4 last:border-r-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
            Attempted
          </div>
          <div className="mt-1.5 font-serif text-[26px] leading-none">
            {e.attempted.toLocaleString("en-US")}
          </div>
        </div>
        <div className="border-r border-line px-3.5 py-4 last:border-r-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
            OK
          </div>
          <div className="mt-1.5 font-serif text-[26px] leading-none text-[#3f6f43]">
            {e.ok.toLocaleString("en-US")}
          </div>
        </div>
        <div className="border-r border-line px-3.5 py-4 last:border-r-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
            Failed
          </div>
          <div className="mt-1.5 font-serif text-[26px] leading-none text-[#9d2f22]">
            {e.failed.toLocaleString("en-US")}
          </div>
        </div>
        <div className="border-r border-line px-3.5 py-4 last:border-r-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
            Skipped
          </div>
          <div className="mt-1.5 font-serif text-[26px] leading-none">
            {e.skipped.toLocaleString("en-US")}
          </div>
        </div>
        <div className="border-r border-line px-3.5 py-4 last:border-r-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
            Avg fetch
          </div>
          <div className="mt-1.5 font-serif text-[26px] leading-none">
            {Math.round(e.avgFetchMs)}
            <span className="text-[13px] text-mute">ms</span>
          </div>
        </div>
      </div>
      {skipReasons.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {e.cacheHits > 0 ? (
            <span className="rounded-[3px] border border-line bg-chip px-2.5 py-1.5 font-mono text-[11px] text-mute">
              cache-hit <b className="text-ink-2">{e.cacheHits}</b>
            </span>
          ) : null}
          {skipReasons.map(([reason, count]) => (
            <span
              key={reason}
              data-testid={`skip-chip-${reason}`}
              className="rounded-[3px] border border-line bg-chip px-2.5 py-1.5 font-mono text-[11px] text-mute"
            >
              {reason} <b className="text-ink-2">{count}</b>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
