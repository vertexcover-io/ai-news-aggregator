import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { Masthead } from "../../../../src/components/shell/Masthead";
import {
  AGENTLOOP_BRANDING,
  SECOND_TENANT_BRANDING,
  withBranding,
} from "../../../helpers/branding";

afterEach(() => {
  cleanup();
});

function renderMasthead(
  initialPath = "/",
  branding: TenantBranding = AGENTLOOP_BRANDING,
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        {withBranding(<Masthead />, branding)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Masthead", () => {
  it("renders the AGENTLOOP wordmark", () => {
    renderMasthead();
    expect(screen.getByText("AGENTLOOP")).toBeTruthy();
  });

  it("renders the publication sub-line with a Vertexcover Labs link", () => {
    renderMasthead();
    const link = screen.getByRole("link", { name: /vertexcover labs/i });
    expect(link.getAttribute("href")).toBe("https://blog.vertexcover.io");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders the four top-right nav items including Sources", () => {
    renderMasthead();
    expect(screen.getByRole("link", { name: /must read/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /built/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /subscribe/i })).toBeTruthy();
  });

  it("Subscribe link points to #subscribe on the current page (no leading path)", () => {
    renderMasthead("/built");
    const subscribe = screen.getByRole("link", { name: /subscribe/i });
    // hash-only Link from /built should resolve to /built#subscribe
    expect(subscribe.getAttribute("href")).toBe("/built#subscribe");
  });

  // Merged: nav-item href + active-state matrix. Each case asserts the link's
  // href is stable and that aria-current reflects the current route:
  //  - on /must-read MUST READ is active; on /built BUILT is active;
  //  - on the home route neither is active.
  it.each([
    { path: "/must-read", name: /must read/i, href: "/must-read", activeOn: "/must-read" },
    { path: "/built", name: /built/i, href: "/built", activeOn: "/built" },
  ])(
    "nav item $href: stable href and aria-current driven by route",
    ({ name, href, activeOn }) => {
      // Active when on its own route.
      renderMasthead(activeOn);
      const activeLink = screen.getByRole("link", { name });
      expect(activeLink.getAttribute("href")).toBe(href);
      expect(activeLink.getAttribute("aria-current")).toBe("page");
      cleanup();

      // Not active on the home route.
      renderMasthead("/");
      const inactiveLink = screen.getByRole("link", { name });
      expect(inactiveLink.getAttribute("href")).toBe(href);
      expect(inactiveLink.getAttribute("aria-current")).toBeNull();
    },
  );

  it("AGENTLOOP wordmark links to /", () => {
    renderMasthead("/built");
    const wordmark = screen.getByRole("link", { name: /agentloop/i });
    expect(wordmark.getAttribute("href")).toBe("/");
  });
});

describe("test_REQ_042_nav_derived_from_flags_and_tenant0", () => {
  it("non-zero tenant with canon off: Sources + Subscribe only — no Must Read, no Built, no publication sub-line", () => {
    renderMasthead("/", SECOND_TENANT_BRANDING);
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /subscribe/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /must read/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /built/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /vertexcover labs/i })).toBeNull();
  });

  it("non-zero tenant with canon ON: Must Read appears, Built still hidden", () => {
    renderMasthead("/", {
      ...SECOND_TENANT_BRANDING,
      flags: { canon: true },
    });
    expect(screen.getByRole("link", { name: /must read/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /built/i })).toBeNull();
  });

  it("renders the tenant wordmark, no AGENTLOOP string anywhere (REQ-040)", () => {
    renderMasthead("/", SECOND_TENANT_BRANDING);
    expect(screen.getByText("The Inference")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/agentloop/i);
  });

  it("renders the tenant logo image when logoUrl is set (BrandMark fallback otherwise)", () => {
    renderMasthead("/", SECOND_TENANT_BRANDING);
    const img = document.querySelector(`img[src="${SECOND_TENANT_BRANDING.logoUrl ?? ""}"]`);
    expect(img).not.toBeNull();
    cleanup();
    renderMasthead("/", { ...SECOND_TENANT_BRANDING, logoUrl: null });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
