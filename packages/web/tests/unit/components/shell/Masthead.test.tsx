import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Masthead } from "../../../../src/components/shell/Masthead";

afterEach(() => {
  cleanup();
});

function renderMasthead(initialPath = "/"): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Masthead />
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
