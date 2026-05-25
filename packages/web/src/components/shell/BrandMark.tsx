import type { ReactElement } from "react";

interface BrandMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

/**
 * The AGENTLOOP loop mark: a hairline rust ring broken at the lower-right
 * (the day's loop closes when the issue ships) wrapped around a solid focal
 * dot (many sources converge to one curated digest). Stroke uses currentColor
 * so callers can recolor it via text color; defaults to the rust accent.
 */
export function BrandMark({
  size = 28,
  className,
}: BrandMarkProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="AGENTLOOP"
      className={className}
    >
      <circle
        cx="50"
        cy="50"
        r="45"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength="360"
        strokeDasharray="344 360"
        strokeDashoffset="-55"
      />
      <circle cx="50" cy="50" r="12" fill="currentColor" />
    </svg>
  );
}
