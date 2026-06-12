import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  LivePreview,
  type PreviewBranding,
} from "../../../../src/pages/onboarding/LivePreview";

afterEach(cleanup);

function branding(overrides: Partial<PreviewBranding> = {}): PreviewBranding {
  return {
    name: "The Inference",
    slug: "theinference",
    headline: "Built for people shipping inference.",
    topicStrip: "Serving · Quantization · Latency",
    subtagline: "Just the runtime.",
    logoVersion: 0,
    ...overrides,
  };
}

describe("LivePreview (REQ-034)", () => {
  it("feeds the form state through the real public Home components", () => {
    render(<LivePreview branding={branding()} />);

    // Real Masthead wordmark + nav.
    expect(screen.getByText("The Inference")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sources" })).toBeTruthy();

    // Hero slots from the typed branding.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Built for people shipping inference.");
    expect(screen.getByText("Serving")).toBeTruthy();
    expect(screen.getByText("Quantization")).toBeTruthy();
    expect(screen.getByText("Just the runtime.")).toBeTruthy();

    // Browser-chrome URL mirrors the slug.
    expect(screen.getByTestId("preview-url").textContent).toBe(
      "theinference.ourdomain.com",
    );

    // Everything else is lorem-ipsum placeholder content.
    expect(
      screen.getAllByText(/Lorem Ipsum Dolor Sit Amet/i).length,
    ).toBeGreaterThan(0);
  });

  it("re-renders when the form state changes", () => {
    const { rerender } = render(<LivePreview branding={branding()} />);
    rerender(
      <LivePreview
        branding={branding({ name: "Daily Tokens", slug: "daily-tokens", headline: "All tokens, daily." })}
      />,
    );

    expect(screen.getByText("Daily Tokens")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "All tokens, daily.",
    );
    expect(screen.getByTestId("preview-url").textContent).toBe(
      "daily-tokens.ourdomain.com",
    );
  });

  it("falls back to placeholder slots while fields are empty", () => {
    render(
      <LivePreview
        branding={branding({ name: "", slug: "", headline: "", topicStrip: "", subtagline: "" })}
      />,
    );
    expect(screen.getByText("Your newsletter")).toBeTruthy();
    expect(screen.getByTestId("preview-url").textContent).toBe(
      "yourslug.ourdomain.com",
    );
  });
});
