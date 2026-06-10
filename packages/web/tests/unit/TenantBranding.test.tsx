import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { TenantBrandingProvider, useTenantBranding } from "@/context/TenantBrandingContext";
import type { TenantBranding } from "@newsletter/shared/types";

describe("TenantBrandingContext", () => {
  it("provides default AGENTLOOP branding when none set", () => {
    const { result } = renderHook(() => useTenantBranding(), {
      wrapper: ({ children }) => (
        <TenantBrandingProvider
          branding={{
            name: "AGENTLOOP",
            headline: null,
            topicStrip: null,
            subtagline: null,
            logoUrl: null,
            flags: { canon: true, isTenantZero: true },
          }}
        >
          {children}
        </TenantBrandingProvider>
      ),
    });
    expect(result.current.name).toBe("AGENTLOOP");
    expect(result.current.flags.canon).toBe(true);
    expect(result.current.flags.isTenantZero).toBe(true);
  });

  it("serves non-zero tenant branding with canon=false", () => {
    const branding: TenantBranding = {
      name: "Acme AI",
      headline: "Acme AI Weekly",
      topicStrip: "AI · LLM · AGENTS",
      subtagline: "What matters.",
      logoUrl: "/api/logo/acme-ai",
      flags: { canon: false, isTenantZero: false },
    };
    const { result } = renderHook(() => useTenantBranding(), {
      wrapper: ({ children }) => (
        <TenantBrandingProvider branding={branding}>
          {children}
        </TenantBrandingProvider>
      ),
    });
    expect(result.current.name).toBe("Acme AI");
    expect(result.current.headline).toBe("Acme AI Weekly");
    expect(result.current.topicStrip).toBe("AI · LLM · AGENTS");
    expect(result.current.subtagline).toBe("What matters.");
    expect(result.current.logoUrl).toBe("/api/logo/acme-ai");
    expect(result.current.flags.canon).toBe(false);
    expect(result.current.flags.isTenantZero).toBe(false);
  });
});
