import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ArchiveStoryCard } from "../../src/components/ArchiveStoryCard";
import type { RankedItem } from "@newsletter/shared";

const baseItem: RankedItem = {
  id: 1,
  rawItemId: 10,
  title: "Advances in LLM Reasoning",
  url: "https://example.com/article",
  sourceType: "hn",
  author: "jdoe",
  publishedAt: "2026-04-18T12:00:00Z",
  engagement: { points: 342, commentCount: 45 },
  score: 0.9,
  rationale: "This article covers key reasoning improvements in large language models.",
  content: "Full article body text here.",
  imageUrl: null,
  recap: null,
};

const itemWithRecap: RankedItem = {
  ...baseItem,
  imageUrl: "https://example.com/image.jpg",
  recap: {
    title: "Test recap title",
    summary: "Test summary of the article",
    bullets: ["Point 1", "Point 2", "Point 3"],
    bottomLine: "Test bottom line takeaway",
  },
};

describe("ArchiveStoryCard (Mock-A layout)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an <article>", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getAllByRole("article").length).toBeGreaterThanOrEqual(1);
  });

  it("Mock-A: does not render a numbered rail (no 'N°' eyebrow)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.queryByText("N°")).toBeNull();
  });

  it("Mock-A: does not render a LEAD STORY tag", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.queryByText(/LEAD STORY/)).toBeNull();
  });

  it("Mock-A: does not render engagement metrics in the markup (no ▲ / COMMENTS)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(container.textContent).not.toContain("▲");
    expect(container.textContent).not.toContain("COMMENTS");
  });

  it("headline is wrapped in an anchor pointing to item.url with target=_blank", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    const link = screen.getByRole("link", { name: /Advances in LLM Reasoning/ });
    expect(link.getAttribute("href")).toBe("https://example.com/article");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("source line shows the source label and a 'Read source' link to item.url", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    const sourceLink = screen.getByRole("link", { name: /Read source/i });
    expect(sourceLink.getAttribute("href")).toBe("https://example.com/article");
    expect(sourceLink.getAttribute("target")).toBe("_blank");
  });

  it("renders the image when imageUrl is set", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.com/image.jpg");
  });

  it("does not render an image (or fallback placeholder) when imageUrl is null", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-slot="story-image"]')).toBeNull();
  });

  it("unmounts the image after onError fires (no broken-image artifact)", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the italic recap.summary lede", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    const italic = container.querySelector(".italic");
    expect(italic?.textContent).toContain("Test summary of the article");
  });

  it("renders 'Unpacked' label and bullet list when bullets >= 1", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    expect(screen.getByText(/Unpacked/i)).toBeTruthy();
    expect(screen.getByText("Point 1")).toBeTruthy();
    expect(screen.getByText("Point 2")).toBeTruthy();
    expect(screen.getByText("Point 3")).toBeTruthy();
  });

  it("does not render 'Unpacked' label when bullets array is empty", () => {
    const item: RankedItem = {
      ...itemWithRecap,
      recap: { title: "Test title", summary: "Some summary", bullets: [], bottomLine: "" },
    };
    render(<ArchiveStoryCard item={item} rank={1} />);
    expect(screen.queryByText(/Unpacked/i)).toBeNull();
  });

  it("renders 'Bottom line' block when bottomLine is non-empty", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    expect(screen.getByText(/^Bottom line$/i)).toBeTruthy();
    expect(screen.getByText("Test bottom line takeaway")).toBeTruthy();
  });

  it("does not render 'Bottom line' when bottomLine is empty", () => {
    const item: RankedItem = {
      ...itemWithRecap,
      recap: { title: "Test title", summary: "Some summary", bullets: ["A bullet"], bottomLine: "" },
    };
    render(<ArchiveStoryCard item={item} rank={1} />);
    expect(screen.queryByText(/^Bottom line$/i)).toBeNull();
  });

  it("falls back to rationale when recap is null (still renders content)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(container.textContent).toContain(
      "This article covers key reasoning improvements",
    );
  });

  it("does not render a 'READ THE ORIGINAL' button (replaced by source line link)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.queryByText(/READ THE ORIGINAL/i)).toBeNull();
  });
});
