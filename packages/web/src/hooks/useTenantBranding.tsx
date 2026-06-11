/**
 * Tenant branding context (P7, REQ-040/041/042).
 *
 * The public chrome (Masthead, Footer, Hero, Elsewhere, subscribe cards)
 * reads every brand slot — name, logo, headline, topic strip, subtagline,
 * nav flags — from this context instead of hardcoded strings. The provider
 * fetches `GET /api/branding` once (the API resolves the tenant from the
 * request Host) and **renders nothing until branding resolves**, so a
 * non-zero tenant's page can never flash another tenant's brand (REQ-040).
 *
 * On fetch error it falls back to a conservative empty brand (no name, no
 * canon, not tenant 0) — flag-gated nav defaults to hidden, never shown.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { getBranding } from "../api/branding";

export const FALLBACK_BRANDING: TenantBranding = {
  name: "",
  headline: null,
  topicStrip: null,
  subtagline: null,
  logoUrl: null,
  flags: { canon: false },
  isTenantZero: false,
};

/** Exported for tests (wrap components in a fixed value) — app code uses the provider + hook. */
export const TenantBrandingContext = createContext<TenantBranding | null>(null);

export function TenantBrandingProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement | null {
  const { data, isError } = useQuery({
    queryKey: ["branding"],
    queryFn: getBranding,
    staleTime: Infinity,
    retry: 1,
  });
  const value = data ?? (isError ? FALLBACK_BRANDING : null);
  if (value === null) return null; // gate the chrome — no brand flash (REQ-040)
  return (
    <TenantBrandingContext.Provider value={value}>
      {children}
    </TenantBrandingContext.Provider>
  );
}

export function useTenantBranding(): TenantBranding {
  return useContext(TenantBrandingContext) ?? FALLBACK_BRANDING;
}

/**
 * Mixed-case display name for prose slots ("Read {name} every morning.").
 * Tenant 0's stored name is the all-caps wordmark "AGENTLOOP"; prose on the
 * legacy site reads "AgentLoop" — preserve that exact copy (REQ-041) while
 * every other tenant uses its configured name verbatim.
 */
export function brandDisplayName(branding: TenantBranding): string {
  return branding.isTenantZero ? "AgentLoop" : branding.name;
}
