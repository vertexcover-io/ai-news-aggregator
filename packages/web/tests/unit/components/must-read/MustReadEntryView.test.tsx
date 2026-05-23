import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MustReadEntryView } from "../../../../src/components/must-read/MustReadEntryView";
import type { PublicMustReadEntry } from "@newsletter/shared/types";

afterEach(cleanup);

function makeEntry(overrides: Partial<PublicMustReadEntry> = {}): PublicMustReadEntry {
  return {
    id: "entry-1",
    url: "https://example.com/an-essay",
    title: "An essay title",
    author: "Author Name",
    year: 2025,
    annotation: "A short note on why this matters.",
    addedAt: "2026-05-14T10:00:00Z",
    ...overrides,
  };
}

describe("MustReadEntryView", () => {
  it("renders the title", () => {
    const { container } = render(<MustReadEntryView entry={makeEntry()} />);
    expect(container.textContent).toContain("An essay title");
  });

  it("renders mono ADDED eyebrow", () => {
    const { container } = render(<MustReadEntryView entry={makeEntry()} />);
    expect(container.textContent).toMatch(/ADDED:\s*May 14, 2026/);
  });

  it("renders italic annotation", () => {
    const { container } = render(<MustReadEntryView entry={makeEntry()} />);
    expect(container.textContent).toContain("A short note on why this matters.");
  });

  it("renders source link with host and rel/target attributes", () => {
    const { container } = render(<MustReadEntryView entry={makeEntry()} />);
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com/an-essay");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.textContent).toContain("example.com");
  });

  it("strips www. prefix from host", () => {
    const { container } = render(
      <MustReadEntryView entry={makeEntry({ url: "https://www.example.com/foo" })} />,
    );
    const link = container.querySelector("a");
    expect(link?.textContent).toContain("example.com");
    expect(link?.textContent).not.toContain("www.");
  });

  it("renders Author · Year byline when both present", () => {
    const { container } = render(<MustReadEntryView entry={makeEntry()} />);
    expect(container.textContent).toContain("Author Name · 2025");
  });

  it("EDGE-015: renders nothing for byline when author and year are both null", () => {
    const { container } = render(
      <MustReadEntryView entry={makeEntry({ author: null, year: null })} />,
    );
    expect(container.textContent).not.toContain("·");
    // No stray byline div: textContent should NOT include " · "
    const text = container.textContent ?? "";
    // The title is rendered, but no byline line. Check that nothing between title and annotation contains a · separator (the article eyebrow and source link · should not exist either)
    expect(text).not.toMatch(/\s·\s/);
  });

  it("EDGE-015: renders only year when author is null", () => {
    const { container } = render(
      <MustReadEntryView entry={makeEntry({ author: null, year: 2024 })} />,
    );
    expect(container.textContent).toContain("2024");
    expect(container.textContent).not.toMatch(/\s·\s2024/);
  });

  it("EDGE-015: renders only author when year is null", () => {
    const { container } = render(
      <MustReadEntryView entry={makeEntry({ author: "Karpathy", year: null })} />,
    );
    expect(container.textContent).toContain("Karpathy");
    // No "·" sep
    expect(container.textContent).not.toMatch(/Karpathy\s*·/);
  });

  it("EDGE-012: always sets canonical rel/target even if data unusual", () => {
    // Test that the component does not take rel/target from the data — they're hard-coded.
    const { container } = render(<MustReadEntryView entry={makeEntry()} />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
