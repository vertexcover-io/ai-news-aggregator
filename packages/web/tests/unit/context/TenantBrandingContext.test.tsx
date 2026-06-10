import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { TenantBranding } from "../../../src/api/tenant-branding";
import {
  TenantBrandingProvider,
  useBrand,
} from "../../../src/context/TenantBrandingContext";

vi.mock("../../../src/api/tenant-branding", () => ({
  getBranding: vi.fn(),
}));

import { getBranding } from "../../../src/api/tenant-branding";

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <TenantBrandingProvider>{children}</TenantBrandingProvider>
      </QueryClientProvider>
    );
  };
}

const full: TenantBranding = {
  name: "Acme Daily",
  headline: "Acme AI news",
  topicStrip: "LLMs · Agents",
  subtagline: "by Acme",
  logoVersion: 3,
  hasLogo: true,
  nav: { sources: true, mustRead: true, built: false },
};

beforeEach(() => {
  vi.mocked(getBranding).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useBrand", () => {
  it("returns sensible fallbacks before data loads (never hardcodes a tenant name)", () => {
    vi.mocked(getBranding).mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useBrand(), { wrapper: makeWrapper() });
    expect(result.current.name).toBe("Daily Read");
    expect(result.current.headline).toBe("Your daily AI briefing");
    expect(result.current.logoUrl).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("resolves loaded branding and builds a versioned logo URL", async () => {
    vi.mocked(getBranding).mockResolvedValue(full);
    const { result } = renderHook(() => useBrand(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.name).toBe("Acme Daily");
    });
    expect(result.current.topicStrip).toBe("LLMs · Agents");
    expect(result.current.logoUrl).toBe("/api/tenant/logo?v=3");
    expect(result.current.nav.mustRead).toBe(true);
  });

  it("falls back to defaults outside a provider", () => {
    const { result } = renderHook(() => useBrand());
    expect(result.current.name).toBe("Daily Read");
    expect(result.current.isLoading).toBe(false);
  });
});
