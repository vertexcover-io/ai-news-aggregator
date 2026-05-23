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

  it("renders the three top-right nav items", () => {
    renderMasthead();
    expect(screen.getByRole("link", { name: /must read/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /built/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /subscribe/i })).toBeTruthy();
  });

  it("MUST READ and BUILT links collapse on mobile (have hidden sm:inline classes)", () => {
    renderMasthead();
    const mustRead = screen.getByRole("link", { name: /must read/i });
    const built = screen.getByRole("link", { name: /built/i });
    expect(mustRead.className).toMatch(/hidden/);
    expect(mustRead.className).toMatch(/sm:/);
    expect(built.className).toMatch(/hidden/);
    expect(built.className).toMatch(/sm:/);
  });

  it("SUBSCRIBE → remains visible on mobile (no hidden class)", () => {
    renderMasthead();
    const subscribe = screen.getByRole("link", { name: /subscribe/i });
    expect(subscribe.className).not.toMatch(/\bhidden\b/);
  });

  it("marks MUST READ as active when on /must-read", () => {
    renderMasthead("/must-read");
    const mustRead = screen.getByRole("link", { name: /must read/i });
    expect(mustRead.getAttribute("aria-current")).toBe("page");
  });

  it("marks BUILT as active when on /built", () => {
    renderMasthead("/built");
    const built = screen.getByRole("link", { name: /built/i });
    expect(built.getAttribute("aria-current")).toBe("page");
  });

  it("no nav item is active on the home route", () => {
    renderMasthead("/");
    expect(
      screen.getByRole("link", { name: /must read/i }).getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /built/i }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("MUST READ link points to /must-read", () => {
    renderMasthead();
    expect(
      screen.getByRole("link", { name: /must read/i }).getAttribute("href"),
    ).toBe("/must-read");
  });

  it("BUILT link points to /built", () => {
    renderMasthead();
    expect(
      screen.getByRole("link", { name: /built/i }).getAttribute("href"),
    ).toBe("/built");
  });

  it("AGENTLOOP wordmark links to /", () => {
    renderMasthead("/built");
    const wordmark = screen.getByRole("link", { name: /agentloop/i });
    expect(wordmark.getAttribute("href")).toBe("/");
  });
});
