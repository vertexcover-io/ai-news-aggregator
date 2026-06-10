import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResolvedBranding } from "../../../src/context/TenantBrandingContext";
import { InlineSubscribeCard } from "../../../src/components/shell/InlineSubscribeCard";

vi.mock("../../../src/context/TenantBrandingContext", () => ({
  useBrand: vi.fn(),
}));

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

vi.mock("../../../src/hooks/useIsSubscribed", () => ({
  useIsSubscribed: vi.fn(() => false),
}));

import { useBrand } from "../../../src/context/TenantBrandingContext";

const mockUseBrand = vi.mocked(useBrand);

function brand(name: string): ResolvedBranding {
  return {
    name,
    headline: "Your daily AI briefing",
    topicStrip: null,
    subtagline: null,
    logoVersion: 0,
    hasLogo: false,
    logoUrl: null,
    nav: { sources: true, mustRead: false, built: false },
    isLoading: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InlineSubscribeCard", () => {
  it("uses the configured tenant name in the headline", () => {
    mockUseBrand.mockReturnValue(brand("The Inference"));
    render(
      <MemoryRouter>
        <InlineSubscribeCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Read The Inference every morning\./i)).toBeTruthy();
    expect(
      screen.getByRole("form", { name: /subscribe to the inference/i }),
    ).toBeTruthy();
  });
});
