import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { Footer } from "../../../../src/components/shell/Footer";
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
  try {
    window.localStorage.clear();
  } catch {
    /* localStorage not available in this jsdom build */
  }
});

function renderFooter(
  branding: TenantBranding = AGENTLOOP_BRANDING,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>{withBranding(<Footer />, branding)}</MemoryRouter>,
  );
}

describe("Footer", () => {
  it("renders the colophon italic line", () => {
    renderFooter();
    expect(
      screen.getByText(/AgentLoop is built by agents/i),
    ).toBeTruthy();
  });

  it("renders 'See how it's built →' link pointing to /built", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: /see how it's built/i });
    expect(link.getAttribute("href")).toBe("/built");
  });

  it("renders the AGENTLOOP wordmark in the masthead row", () => {
    renderFooter();
    expect(screen.getAllByText("AGENTLOOP").length).toBeGreaterThan(0);
  });

  it("renders the publication sub-line with a Vertexcover Labs link in the footer", () => {
    renderFooter();
    const vlLinks = screen
      .getAllByRole("link", { name: /vertexcover labs/i })
      .filter((el) => el.getAttribute("href") === "https://blog.vertexcover.io");
    expect(vlLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of vlLinks) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("renders the MUST READ / SOURCES / HOW IT'S BUILT links", () => {
    renderFooter();
    const mustRead = screen.getByRole("link", { name: /^must read$/i });
    const sources = screen.getByRole("link", { name: /^sources$/i });
    const built = screen.getByRole("link", { name: /^how it's built$/i });
    expect(mustRead.getAttribute("href")).toBe("/must-read");
    expect(sources.getAttribute("href")).toBe("/sources");
    expect(built.getAttribute("href")).toBe("/built");
    expect(screen.queryByRole("link", { name: /^rss$/i })).toBeNull();
  });

  it("renders an inline email subscribe field and button in the footer", () => {
    renderFooter();
    // Footer has its own subscribe field (separate from the InlineSubscribeCard).
    const emailInputs = screen
      .getAllByRole("textbox")
      .filter(
        (el): el is HTMLInputElement =>
          el instanceof HTMLInputElement && el.type === "email",
      );
    expect(emailInputs.length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /subscribe|join/i }).length,
    ).toBeGreaterThan(0);
  });

  it("exposes the footer subscribe form as the #subscribe hash target", () => {
    renderFooter();
    const form = screen.getByRole("form", { name: /subscribe in footer/i });
    expect(form.getAttribute("id")).toBe("subscribe");
  });
});

describe("Footer — non-zero tenant (REQ-040/042)", () => {
  it("hides the colophon, Built link, and Vertexcover publication line; shows the tenant name", () => {
    renderFooter(SECOND_TENANT_BRANDING);
    expect(screen.queryByText(/built by agents/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /built/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /vertexcover labs/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /must read/i })).toBeNull(); // canon off
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
    expect(screen.getAllByText("The Inference").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/agentloop|vertexcover/i);
  });

  it("shows the Must Read footer link when the canon flag is on", () => {
    renderFooter({ ...SECOND_TENANT_BRANDING, flags: { canon: true } });
    expect(screen.getByRole("link", { name: /^must read$/i })).toBeTruthy();
  });

  it("copyright line carries the tenant name", () => {
    renderFooter(SECOND_TENANT_BRANDING);
    const year = String(new Date().getFullYear());
    const copy = screen.getByText((text) => text.includes(`© ${year}`));
    expect(copy.textContent).toContain("The Inference");
  });
});
