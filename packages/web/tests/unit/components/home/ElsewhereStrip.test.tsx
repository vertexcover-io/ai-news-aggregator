import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ElsewhereStrip } from "../../../../src/components/home/ElsewhereStrip";
import type { TenantConfig } from "../../../../src/api/tenantConfig";
import {
  makeTenantConfig,
  withTenantConfig,
} from "../../helpers/tenantConfig";

afterEach(cleanup);

function renderStrip(
  config: TenantConfig | null = makeTenantConfig(),
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>{withTenantConfig(<ElsewhereStrip />, config)}</MemoryRouter>,
  );
}

describe("ElsewhereStrip", () => {
  it("renders three columns (must-read, sources, built) when canon + built flags are on", () => {
    const { container } = renderStrip();
    expect(container.querySelector('[data-column="must-read"]')).not.toBeNull();
    expect(container.querySelector('[data-column="sources"]')).not.toBeNull();
    expect(container.querySelector('[data-column="built"]')).not.toBeNull();
  });

  it("REQ-042: only Sources renders when canon and built are off", () => {
    const { container } = renderStrip(
      makeTenantConfig({ flags: { canon: false, built: false } }),
    );
    expect(container.querySelector('[data-column="must-read"]')).toBeNull();
    expect(container.querySelector('[data-column="built"]')).toBeNull();
    expect(container.querySelector('[data-column="sources"]')).not.toBeNull();
  });

  // Each column links to its destination route.
  it.each([
    { column: "sources", href: "/sources" },
    { column: "must-read", href: "/must-read" },
    { column: "built", href: "/built" },
  ])("$column column links to $href", ({ column, href }) => {
    const { container } = renderStrip();
    const col = container.querySelector(`[data-column="${column}"]`);
    const link = col?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(href);
  });

  it("does not render a tools column (removed)", () => {
    const { container } = renderStrip();
    expect(container.querySelector('[data-column="tools"]')).toBeNull();
  });
});
