/**
 * P7 test fixtures: tenant branding values for the public chrome.
 *
 * AGENTLOOP_BRANDING mirrors the P2 backfill row (tenant 0) so existing
 * "AGENTLOOP homepage" assertions keep passing byte-for-byte; SECOND_TENANT_
 * BRANDING mirrors the mocks/public-home.html second-tenant example.
 */
import type { ReactElement, ReactNode } from "react";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { TenantBrandingContext } from "../../src/hooks/useTenantBranding";

export const AGENTLOOP_BRANDING: TenantBranding = {
  name: "AGENTLOOP",
  headline: "The daily read for people who ship with agents.",
  topicStrip:
    "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
  subtagline: "No model releases. No benchmarks. No discourse. Just the craft.",
  logoUrl: null,
  flags: { canon: true },
  isTenantZero: true,
};

export const SECOND_TENANT_BRANDING: TenantBranding = {
  name: "The Inference",
  headline: "The daily read for people building with inference.",
  topicStrip: "SERVING · QUANTIZATION · LATENCY · COST",
  subtagline: "No funding rounds. No leaderboards. No discourse. Just the runtime.",
  logoUrl: "/api/branding/logo?v=abc1234",
  flags: { canon: false },
  isTenantZero: false,
};

export function withBranding(
  ui: ReactNode,
  branding: TenantBranding = AGENTLOOP_BRANDING,
): ReactElement {
  return (
    <TenantBrandingContext.Provider value={branding}>
      {ui}
    </TenantBrandingContext.Provider>
  );
}
