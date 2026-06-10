import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import type { TenantBranding } from "@newsletter/shared/types";

const DEFAULT_BRANDING: TenantBranding = {
  name: "AGENTLOOP",
  headline: "The daily read for people who ship with agents.",
  topicStrip:
    "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
  subtagline: "No model releases. No benchmarks. No discourse. Just the craft.",
  logoUrl: null,
  flags: { canon: true, isTenantZero: true },
};

const TenantBrandingContext = createContext(DEFAULT_BRANDING);

/** Retrieve the current tenant branding from context. */
export function useTenantBranding(): TenantBranding {
  return useContext(TenantBrandingContext);
}

export interface TenantBrandingProviderProps {
  branding: TenantBranding;
  children: ReactNode;
}

/**
 * Provide tenant branding down the component tree so shell/components
 * never hardcode brand strings.
 */
export function TenantBrandingProvider({
  branding,
  children,
}: TenantBrandingProviderProps): ReactElement {
  return (
    <TenantBrandingContext.Provider value={branding}>
      {children}
    </TenantBrandingContext.Provider>
  );
}
