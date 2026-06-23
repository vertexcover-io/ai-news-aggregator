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
  it("renders the serif headline 'Read AgentLoop every morning.' for tenant 0", () => {
    renderCard();
    expect(screen.getByText(/Read AgentLoop every morning/i)).toBeTruthy();
  });

  it("renders the mono sub-line 'What we read so you don't have to. 7am daily, free.' for tenant 0", () => {
    renderCard();
    expect(
      screen.getByText(/what we read so you don't have to.*7am daily.*free/i),
    ).toBeTruthy();
  });

  it("renders an email input and SUBSCRIBE button", () => {
    renderCard();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /subscribe/i })).toBeTruthy();
  });

  it("non-zero tenant: headline uses the tenant name and the sub-line drops the 7am copy (REQ-040)", () => {
    renderCard(SECOND_TENANT_BRANDING);
    expect(screen.getByText(/Read The Inference every morning/i)).toBeTruthy();
    expect(
      screen.getByText(/what we read so you don't have to.*daily.*free/i),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/agentloop|7am/i);
  });
});
