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

  // Merged byline matrix (EDGE-015): the "Author · Year" byline renders the
  // dot separator only when BOTH author and year are present; a single field
  // renders alone; both-null renders no byline at all.
  it.each<{
    name: string;
    author: string | null;
    year: number | null;
    visible: string | null;
    absentSeparator: RegExp;
  }>([
    {
      name: "author + year → 'Author · Year'",
      author: "Author Name",
      year: 2025,
      visible: "Author Name · 2025",
      absentSeparator: /(?!)/, // separator IS expected here; no absence to assert
    },
    {
      name: "both null → no byline",
      author: null,
      year: null,
      visible: null,
      absentSeparator: /\s·\s/,
    },
    {
      name: "only year",
      author: null,
      year: 2024,
      visible: "2024",
      absentSeparator: /\s·\s2024/,
    },
    {
      name: "only author",
      author: "Karpathy",
      year: null,
      visible: "Karpathy",
      absentSeparator: /Karpathy\s*·/,
    },
  ])("byline: $name", ({ author, year, visible, absentSeparator }) => {
    const { container } = render(
      <MustReadEntryView entry={makeEntry({ author, year })} />,
    );
    const text = container.textContent ?? "";
    if (visible !== null) {
      expect(text).toContain(visible);
    }
    // The both-present case expects the separator, so its regex never matches
    // real content (`(?!)`); all other cases assert the separator is absent.
    if (absentSeparator.source !== "(?!)") {
      expect(text).not.toMatch(absentSeparator);
    }
  });
});
