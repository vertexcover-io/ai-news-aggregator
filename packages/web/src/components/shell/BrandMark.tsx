import type { ReactElement } from "react";

interface BrandMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
  /** Tenant logo URL (versioned). When set, renders the uploaded logo. */
  logoUrl?: string | null;
  /** Accessible label / alt text for the mark (tenant name). */
  label?: string;
}

/**
 * The newsletter mark. When the tenant has uploaded a logo (`logoUrl`), it is
 * rendered as a square image; otherwise we fall back to the default loop glyph:
 * a hairline rust ring broken at the lower-right wrapped around a solid focal
 * dot. The glyph's stroke uses currentColor so callers can recolor it via text
 * color; defaults to the rust accent.
 */
export function BrandMark({
  size = 28,
  className,
  logoUrl = null,
  label = "Newsletter",
}: BrandMarkProps): ReactElement {
  if (logoUrl !== null) {
    return (
      <img
        src={logoUrl}
        width={size}
        height={size}
        alt={label}
        className={className}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }
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
