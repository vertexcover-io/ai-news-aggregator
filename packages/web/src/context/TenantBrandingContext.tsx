import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TenantBranding } from "../api/tenant-branding";
import { useTenantBranding } from "../hooks/useTenantBranding";

export interface ResolvedBranding {
  name: string;
  headline: string;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
  hasLogo: boolean;
  logoUrl: string | null;
  nav: {
    sources: boolean;
    mustRead: boolean;
    built: boolean;
  };
  isLoading: boolean;
}

const FALLBACK_BRANDING: TenantBranding = {
  name: null,
  headline: null,
  topicStrip: null,
  subtagline: null,
  logoVersion: 0,
  hasLogo: false,
  nav: { sources: true, mustRead: false, built: false },
};

function trimmedOr<T extends string | null>(
  value: string | null,
  fallback: T,
): string | T {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

function resolve(
  branding: TenantBranding,
  isLoading: boolean,
): ResolvedBranding {
  return {
    name: trimmedOr(branding.name, "Daily Read"),
    headline: trimmedOr(branding.headline, "Your daily AI briefing"),
    topicStrip: trimmedOr(branding.topicStrip, null),
    subtagline: trimmedOr(branding.subtagline, null),
    logoVersion: branding.logoVersion,
    hasLogo: branding.hasLogo,
    logoUrl: branding.hasLogo
      ? `/api/tenant/logo?v=${String(branding.logoVersion)}`
      : null,
    nav: branding.nav,
    isLoading,
  };
}

const TenantBrandingContext = createContext<ResolvedBranding | null>(null);

export function TenantBrandingProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const query = useTenantBranding();
  const value = useMemo(
    () => resolve(query.data ?? FALLBACK_BRANDING, query.isLoading),
    [query.data, query.isLoading],
  );
  return (
    <TenantBrandingContext.Provider value={value}>
      {children}
    </TenantBrandingContext.Provider>
  );
}

export function useBrand(): ResolvedBranding {
  const ctx = useContext(TenantBrandingContext);
  if (ctx === null) {
    return resolve(FALLBACK_BRANDING, false);
  }
  return ctx;
}
