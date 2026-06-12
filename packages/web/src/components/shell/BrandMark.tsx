import { useState, type ReactElement } from "react";
import { tenantLogoUrl } from "../../api/tenantConfig";
import { useTenantConfig } from "./TenantConfigProvider";

interface BrandMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

function DefaultMark({
  size,
  className,
}: {
  size: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
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

/**
 * The tenant's brand mark: the uploaded logo (version-keyed URL for immutable
 * caching) when one exists, otherwise the default loop mark — a hairline ring
 * broken at the lower-right around a solid focal dot. Decorative: the adjacent
 * wordmark carries the accessible name.
 */
export function BrandMark({
  size = 28,
  className,
}: BrandMarkProps): ReactElement {
  const config = useTenantConfig();
  const [imgFailed, setImgFailed] = useState(false);
  const logoVersion = config?.logoVersion ?? 0;

  if (logoVersion > 0 && !imgFailed) {
    return (
      <img
        src={tenantLogoUrl(logoVersion)}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className={className ? `object-contain ${className}` : "object-contain"}
        onError={() => {
          setImgFailed(true);
        }}
      />
    );
  }

  return <DefaultMark size={size} className={className} />;
}
