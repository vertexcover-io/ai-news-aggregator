import { createContext, useContext } from "react";

export interface TenantBranding {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoUrl: string | null;
  slug: string;
  flags: {
    canon: boolean;
    deliverability: boolean;
    eval: boolean;
  };
  isTenantZero: boolean;
}

/** Default branding used when no tenant context is loaded (legacy AGENTLOOP). */
export const DEFAULT_BRANDING: TenantBranding = {
  name: "AGENTLOOP",
  headline: "AI news, curated",
  topicStrip: "AI",
  subtagline: "A Vertexcover Labs publication",
  logoUrl: null,
  slug: "agentloop",
  flags: {
    canon: true,
    deliverability: true,
    eval: false,
  },
  isTenantZero: true,
};

export const TenantBrandingContext = createContext<TenantBranding>(DEFAULT_BRANDING);

/** Hook to read the current tenant's branding. Falls back to DEFAULT_BRANDING. */
export function useTenantBranding(): TenantBranding {
  return useContext(TenantBrandingContext);
}
