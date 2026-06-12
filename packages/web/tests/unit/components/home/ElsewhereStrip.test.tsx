import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { ElsewhereStrip } from "../../../../src/components/home/ElsewhereStrip";
import {
  AGENTLOOP_BRANDING,
  SECOND_TENANT_BRANDING,
  withBranding,
} from "../../../helpers/branding";

afterEach(cleanup);

function renderStrip(
  branding: TenantBranding = AGENTLOOP_BRANDING,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>{withBranding(<ElsewhereStrip />, branding)}</MemoryRouter>,
  );
}

describe("ElsewhereStrip", () => {
  it("renders three columns (must-read, sources, built) for tenant 0 with canon on", () => {
    const { container } = renderStrip();
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
    const { container } = renderStrip();
    const col = container.querySelector(`[data-column="${column}"]`);
    const link = col?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(href);
  });

  it("does not render a tools column (removed)", () => {
    const { container } = renderStrip();
    expect(container.querySelector('[data-column="tools"]')).toBeNull();
  });

  // REQ-042: the strip filters its columns the same way the nav does —
  // Sources always; Must Read only when canon is on; Built only tenant 0.
  it.each([
    {
      label: "non-zero tenant, canon off → sources only",
      branding: SECOND_TENANT_BRANDING,
      expected: { "must-read": false, sources: true, built: false },
    },
    {
      label: "non-zero tenant, canon on → must-read + sources",
      branding: { ...SECOND_TENANT_BRANDING, flags: { canon: true } },
      expected: { "must-read": true, sources: true, built: false },
    },
    {
      label: "tenant 0, canon off → sources + built (EDGE-014: hidden, not deleted)",
      branding: { ...AGENTLOOP_BRANDING, flags: { canon: false } },
      expected: { "must-read": false, sources: true, built: true },
    },
  ])("$label", ({ branding, expected }) => {
    const { container } = renderStrip(branding);
    for (const [column, present] of Object.entries(expected)) {
      const node = container.querySelector(`[data-column="${column}"]`);
      if (present) {
        expect(node, column).not.toBeNull();
      } else {
        expect(node, column).toBeNull();
      }
    }
  });
});
