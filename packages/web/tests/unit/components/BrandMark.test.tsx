import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BrandMark } from "../../../src/components/shell/BrandMark";

afterEach(() => {
  cleanup();
});

describe("BrandMark", () => {
  it("renders the loop glyph (svg) when no logo URL is supplied", () => {
    render(<BrandMark label="Daily Read" />);
    const svg = screen.getByRole("img", { name: "Daily Read" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("renders the tenant logo image when a logoUrl is supplied", () => {
    render(<BrandMark label="The Inference" logoUrl="/api/tenant/logo?v=4" />);
    const img = screen.getByAltText("The Inference");
    expect(img.tagName.toLowerCase()).toBe("img");
    expect(img.getAttribute("src")).toBe("/api/tenant/logo?v=4");
  });
});
