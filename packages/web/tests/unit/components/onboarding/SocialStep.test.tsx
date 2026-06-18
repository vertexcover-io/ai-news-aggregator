/**
 * SocialStep (Fix #3): the old free-text "Sending email" input is gone —
 * email sends from a read-only managed default `<slug>@<managed domain>`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SocialStep } from "../../../../src/components/onboarding/SocialStep";
import type { OnboardingData } from "@newsletter/shared/types/tenant";

// The OAuth connect controls hit react-query hooks; stub them out so the test
// targets only the sender display.
vi.mock("../../../../src/components/SocialConnectControls", () => ({
  SocialConnectControls: () => null,
}));
vi.mock("../../../../src/api/socialCredentials", () => ({
  useLinkedInOAuthStatus: vi.fn(),
  startLinkedInOAuth: vi.fn(),
  useTwitterOAuthStatus: vi.fn(),
  startTwitterOAuth: vi.fn(),
}));

function renderStep(data: OnboardingData): void {
  render(
    <MemoryRouter>
      <SocialStep data={data} update={vi.fn()} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SocialStep sending address", () => {
  it("shows the read-only managed default sender derived from the slug", () => {
    renderStep({ slug: "inference" });
    expect(screen.getByTestId("onboarding-sender").textContent).toBe(
      "inference@news.vertexcover.io",
    );
    // No free-text email input anymore.
    expect(screen.queryByLabelText(/sending email/i)).toBeNull();
  });

  it("prompts to pick a subdomain when no slug is set yet", () => {
    renderStep({});
    expect(screen.getByTestId("onboarding-sender").textContent).toContain(
      "Pick a subdomain",
    );
  });
});
