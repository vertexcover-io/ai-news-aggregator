import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { InlineSubscribeCard } from "../../../../src/components/shell/InlineSubscribeCard";
import {
  AGENTLOOP_BRANDING,
  SECOND_TENANT_BRANDING,
  withBranding,
} from "../../../helpers/branding";

vi.mock("../../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* localStorage not available in this jsdom build */
  }
});

function renderCard(
  branding: TenantBranding = AGENTLOOP_BRANDING,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>{withBranding(<InlineSubscribeCard />, branding)}</MemoryRouter>,
  );
}

describe("InlineSubscribeCard", () => {
  it("renders the 'Subscribe — free' kicker and serif headline for tenant 0", () => {
    renderCard();
    expect(screen.getByText(/subscribe\s*[—-]\s*free/i)).toBeTruthy();
    expect(screen.getByText(/Subscribe to AgentLoop's daily digest/i)).toBeTruthy();
  });

  it("renders the tenant-0 mono sub-line 'The AI news that matters, ranked. 7am every morning.'", () => {
    renderCard();
    expect(
      screen.getByText(/the ai news that matters, ranked.*7am every morning/i),
    ).toBeTruthy();
  });

  it("renders an email input and SUBSCRIBE button", () => {
    renderCard();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /subscribe/i })).toBeTruthy();
  });

  it("non-zero tenant: headline uses the tenant name and the sub-line drops the 7am copy (REQ-040)", () => {
    renderCard(SECOND_TENANT_BRANDING);
    expect(screen.getByText(/Subscribe to The Inference's daily digest/i)).toBeTruthy();
    expect(
      screen.getByText(/the stories that matter, ranked.*daily/i),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/agentloop|7am/i);
  });
});
