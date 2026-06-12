import type { ReactElement } from "react";

interface BrandMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  /** Accessible label — the tenant name (defaults to AGENTLOOP, tenant 0). */
  label?: string;
  className?: string;
}

/**
 * The AGENTLOOP loop mark: a hairline rust ring broken at the lower-right
 * (the day's loop closes when the issue ships) wrapped around a solid focal
 * dot (many sources converge to one curated digest). Stroke uses currentColor
 * so callers can recolor it via text color; defaults to the rust accent.
 * Doubles as the generic fallback mark for tenants without an uploaded logo
 * (P7) — pass `label` so it never announces another tenant's brand.
 */
export function BrandMark({
  size = 28,
  label = "AGENTLOOP",
  className,
}: BrandMarkProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label={label}
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
