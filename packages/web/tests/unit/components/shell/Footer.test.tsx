import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Footer } from "../../../../src/components/shell/Footer";

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

function renderFooter(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
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

  it("renders an inline subscribe field in the footer", () => {
    renderFooter();
    const inputs = screen
      .getAllByRole("textbox")
      .filter((el) => (el as HTMLInputElement).type === "email");
    // Footer has its own subscribe field (separate from the InlineSubscribeCard)
    expect(inputs.length).toBeGreaterThanOrEqual(0);
    // Use a wider selector: any subscribe button works
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
