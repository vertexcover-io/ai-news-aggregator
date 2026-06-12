import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { BrandMark } from "../../../../src/components/shell/BrandMark";
import type { TenantConfig } from "../../../../src/api/tenantConfig";
import {
  makeTenantConfig,
  withTenantConfig,
} from "../../helpers/tenantConfig";

afterEach(cleanup);

function renderMark(
  config: TenantConfig | null,
): ReturnType<typeof render> {
  return render(withTenantConfig(<BrandMark size={30} />, config));
}

describe("BrandMark", () => {
  it("renders the uploaded logo with a version-keyed URL when logoVersion > 0", () => {
    const { container } = renderMark(makeTenantConfig({ logoVersion: 3 }));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/api/public/tenant-logo?v=3");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the default loop mark when the tenant has no logo", () => {
    const { container } = renderMark(makeTenantConfig({ logoVersion: 0 }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the default mark while config is loading", () => {
    const { container } = renderMark(null);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the default mark when the logo image fails to load", () => {
    const { container } = renderMark(makeTenantConfig({ logoVersion: 2 }));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("is decorative: no AGENTLOOP aria-label baked in", () => {
    const { container } = renderMark(makeTenantConfig());
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
