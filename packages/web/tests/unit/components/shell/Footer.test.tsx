import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Footer } from "../../../../src/components/shell/Footer";
import type { TenantConfig } from "../../../../src/api/tenantConfig";
import {
  makeTenantConfig,
  withTenantConfig,
} from "../../helpers/tenantConfig";

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
  config: TenantConfig | null = makeTenantConfig(),
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>{withTenantConfig(<Footer />, config)}</MemoryRouter>,
  );
}

describe("Footer", () => {
  it("renders the colophon italic line only for the built (tenant 0) flag", () => {
    renderFooter();
    expect(screen.getByText(/AgentLoop is built by agents/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /see how it's built/i });
    expect(link.getAttribute("href")).toBe("/built");
    cleanup();

    renderFooter(makeTenantConfig({ flags: { built: false } }));
    expect(screen.queryByText(/AgentLoop is built by agents/i)).toBeNull();
  });

  it("renders the tenant name as the footer wordmark with no AGENTLOOP brand (REQ-040)", () => {
    renderFooter(
      makeTenantConfig({ name: "The Inference", flags: { built: false } }),
    );
    expect(screen.getByText("The Inference")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/agentloop/i);
  });

  it("renders the Vertexcover Labs publication sub-line only when built is on", () => {
    renderFooter();
    const vlLinks = screen
      .getAllByRole("link", { name: /vertexcover labs/i })
      .filter((el) => el.getAttribute("href") === "https://blog.vertexcover.io");
    expect(vlLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of vlLinks) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    cleanup();

    renderFooter(makeTenantConfig({ flags: { built: false } }));
    expect(screen.queryByRole("link", { name: /vertexcover labs/i })).toBeNull();
  });

  it("renders the MUST READ / SOURCES / HOW IT'S BUILT links when flags allow", () => {
    renderFooter();
    const mustRead = screen.getByRole("link", { name: /^must read$/i });
    const sources = screen.getByRole("link", { name: /^sources$/i });
    const built = screen.getByRole("link", { name: /^how it's built$/i });
    expect(mustRead.getAttribute("href")).toBe("/must-read");
    expect(sources.getAttribute("href")).toBe("/sources");
    expect(built.getAttribute("href")).toBe("/built");
    expect(screen.queryByRole("link", { name: /^rss$/i })).toBeNull();
  });

  it("REQ-042: hides MUST READ when canon is off and HOW IT'S BUILT when built is off", () => {
    renderFooter(makeTenantConfig({ flags: { canon: false, built: false } }));
    expect(screen.queryByRole("link", { name: /^must read$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^how it's built$/i })).toBeNull();
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
  });

  it("renders the tenant name in the copyright line for non-built tenants", () => {
    renderFooter(
      makeTenantConfig({ name: "The Inference", flags: { built: false } }),
    );
    const copyright = `© ${String(new Date().getFullYear())}`;
    expect(document.body.textContent).toContain(copyright);
    expect(document.body.textContent).not.toContain("Vertexcover");
  });

  it("renders an inline email subscribe field and button in the footer", () => {
    renderFooter();
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
