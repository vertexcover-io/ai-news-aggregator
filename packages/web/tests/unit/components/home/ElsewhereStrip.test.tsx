import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ElsewhereStrip } from "../../../../src/components/home/ElsewhereStrip";

afterEach(cleanup);

describe("ElsewhereStrip", () => {
  it("renders three columns (must-read, sources, built)", () => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-column="must-read"]')).not.toBeNull();
    expect(container.querySelector('[data-column="sources"]')).not.toBeNull();
    expect(container.querySelector('[data-column="built"]')).not.toBeNull();
  });

  // Each column links to its destination route.
  it.each([
    { column: "sources", href: "/sources" },
    { column: "must-read", href: "/must-read" },
    { column: "built", href: "/built" },
  ])("$column column links to $href", ({ column, href }) => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    const col = container.querySelector(`[data-column="${column}"]`);
    const link = col?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(href);
  });

  it("does not render a tools column (removed)", () => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-column="tools"]')).toBeNull();
  });
});
