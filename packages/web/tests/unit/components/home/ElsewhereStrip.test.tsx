import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ElsewhereStrip } from "../../../../src/components/home/ElsewhereStrip";

afterEach(cleanup);

describe("ElsewhereStrip", () => {
  it("renders root section with data-section='elsewhere'", () => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-section="elsewhere"]')).not.toBeNull();
  });

  it("renders two columns (must-read, built)", () => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-column="must-read"]')).not.toBeNull();
    expect(container.querySelector('[data-column="built"]')).not.toBeNull();
  });

  it("must-read column links to /must-read", () => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    const col = container.querySelector('[data-column="must-read"]');
    const link = col?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/must-read");
  });

  it("built column links to /built", () => {
    const { container } = render(
      <MemoryRouter>
        <ElsewhereStrip />
      </MemoryRouter>,
    );
    const col = container.querySelector('[data-column="built"]');
    const link = col?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/built");
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
