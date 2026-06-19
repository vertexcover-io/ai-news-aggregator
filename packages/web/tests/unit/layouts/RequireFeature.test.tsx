/**
 * Fix #4: RequireFeature gates an admin route on a tenant feature flag. When the
 * flag is on the nested route renders; when off, the admin sees the disabled
 * notice instead of the page (they keep their nav, so they can reach Settings).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TenantFeatureFlagsWire } from "@newsletter/shared/types/tenant";
import { RequireFeature } from "../../../src/layouts/RequireFeature";

vi.mock("../../../src/api/notifications", () => ({
  getFeatureFlags: vi.fn(),
}));

import { getFeatureFlags } from "../../../src/api/notifications";
const mockGetFeatureFlags = vi.mocked(getFeatureFlags);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function flags(overrides: Partial<TenantFeatureFlagsWire>): TenantFeatureFlagsWire {
  return {
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    ...overrides,
  };
}

function renderGated(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/eval"]}>
        <Routes>
          <Route element={<RequireFeature feature="featureEval" label="Eval" />}>
            <Route path="/admin/eval" element={<div>EVAL SURFACE</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireFeature", () => {
  it("renders the nested route when the flag is on", async () => {
    mockGetFeatureFlags.mockResolvedValue(flags({ featureEval: true }));
    renderGated();
    expect(await screen.findByText("EVAL SURFACE")).toBeTruthy();
  });

  it("renders the disabled notice (not the page) when the flag is off", async () => {
    mockGetFeatureFlags.mockResolvedValue(flags({ featureEval: false }));
    renderGated();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("EVAL SURFACE")).toBeNull();
  });
});
