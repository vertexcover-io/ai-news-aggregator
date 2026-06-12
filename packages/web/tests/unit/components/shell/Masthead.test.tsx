import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Masthead } from "../../../../src/components/shell/Masthead";
import type { TenantConfig } from "../../../../src/api/tenantConfig";
import {
  makeTenantConfig,
  withTenantConfig,
} from "../../helpers/tenantConfig";

afterEach(() => {
  cleanup();
});

function renderMasthead(
  initialPath = "/",
  config: TenantConfig | null = makeTenantConfig(),
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        {withTenantConfig(<Masthead />, config)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Masthead", () => {
  it("renders the tenant name from the provider as the wordmark (REQ-040)", () => {
    renderMasthead("/", makeTenantConfig({ name: "The Inference" }));
    expect(screen.getByText("The Inference")).toBeTruthy();
    expect(screen.queryByText("AGENTLOOP")).toBeNull();
  });

  it("renders the Vertexcover Labs sub-line only when the built flag is on", () => {
    renderMasthead();
    const link = screen.getByRole("link", { name: /vertexcover labs/i });
    expect(link.getAttribute("href")).toBe("https://blog.vertexcover.io");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    cleanup();

    renderMasthead("/", makeTenantConfig({ flags: { built: false } }));
    expect(screen.queryByRole("link", { name: /vertexcover labs/i })).toBeNull();
  });

  it("renders the four top-right nav items when canon and built flags are on", () => {
    renderMasthead();
    expect(screen.getByRole("link", { name: /must read/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /built/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /subscribe/i })).toBeTruthy();
  });

  it("REQ-042: hides Must Read when canon is off and Built when built is off; Sources stays", () => {
    renderMasthead(
      "/",
      makeTenantConfig({ flags: { canon: false, built: false } }),
    );
    expect(screen.queryByRole("link", { name: /must read/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /built/i })).toBeNull();
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /subscribe/i })).toBeTruthy();
  });

  it("renders only Sources + Subscribe while config is loading (no flag or brand leakage)", () => {
    renderMasthead("/", null);
    expect(screen.queryByRole("link", { name: /must read/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /built/i })).toBeNull();
    expect(screen.getByRole("link", { name: /^sources$/i })).toBeTruthy();
    expect(document.body.textContent).not.toContain("AGENTLOOP");
  });

  it("Subscribe link points to #subscribe on the current page (no leading path)", () => {
    renderMasthead("/built");
    const subscribe = screen.getByRole("link", { name: /subscribe/i });
    expect(subscribe.getAttribute("href")).toBe("/built#subscribe");
  });

  it.each([
    { path: "/must-read", name: /must read/i, href: "/must-read", activeOn: "/must-read" },
    { path: "/built", name: /built/i, href: "/built", activeOn: "/built" },
  ])(
    "nav item $href: stable href and aria-current driven by route",
    ({ name, href, activeOn }) => {
      renderMasthead(activeOn);
      const activeLink = screen.getByRole("link", { name });
      expect(activeLink.getAttribute("href")).toBe(href);
      expect(activeLink.getAttribute("aria-current")).toBe("page");
      cleanup();

      renderMasthead("/");
      const inactiveLink = screen.getByRole("link", { name });
      expect(inactiveLink.getAttribute("href")).toBe(href);
      expect(inactiveLink.getAttribute("aria-current")).toBeNull();
    },
  );

  it("wordmark links to / with the tenant name as accessible label", () => {
    renderMasthead("/built", makeTenantConfig({ name: "The Inference" }));
    const wordmark = screen.getByRole("link", {
      name: /the inference — home/i,
    });
    expect(wordmark.getAttribute("href")).toBe("/");
  });
});
