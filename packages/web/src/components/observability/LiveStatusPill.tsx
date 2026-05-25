import type { ReactElement } from "react";
import type { RunStatus } from "@newsletter/shared/types";

interface LiveStatusPillProps {
  status: RunStatus;
  stage: string;
  live: boolean;
}

export function LiveStatusPill({
  status,
  stage,
  live,
}: LiveStatusPillProps): ReactElement {
  const label = stage
    ? `${status.toUpperCase()} · ${stage.toUpperCase()}`
    : status.toUpperCase();

  return (
    <span
      data-testid="live-status-pill"
      data-live={live ? "true" : "false"}
      className={
        live
          ? "inline-flex items-center gap-2 rounded-full border border-rust bg-[#fbf1ee] px-3.5 py-1.5 font-mono text-xs tracking-wide text-rust-deep"
          : "inline-flex items-center gap-2 rounded-full border border-line-strong bg-cream-elev px-3.5 py-1.5 font-mono text-xs tracking-wide text-ink-2"
      }
    >
      <span
        data-testid="live-status-dot"
        className={
          live
            ? "h-2 w-2 animate-pulse rounded-full bg-rust"
            : "h-2 w-2 rounded-full bg-mute-2"
        }
      />
      {label}
    </span>
  );
}
