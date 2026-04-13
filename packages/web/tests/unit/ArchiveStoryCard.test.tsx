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
  publishedAt: "2026-04-13T12:00:00Z",
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
    summary: "Test summary of the article",
    bullets: ["Point 1", "Point 2", "Point 3"],
    bottomLine: "Test bottom line takeaway",
  },
};

describe("ArchiveStoryCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders rank number (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders source type badge (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText("hn")).toBeTruthy();
  });

  it("renders formatted publication date when publishedAt is set (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText(/Apr 13, 2026/)).toBeTruthy();
  });

  it("omits date when publishedAt is null — no 'null' text (EDGE-004)", () => {
    const item = { ...baseItem, publishedAt: null };
    render(<ArchiveStoryCard item={item} rank={1} />);
    expect(screen.queryByText("null")).toBeNull();
  });

  it("renders author when present (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText(/by jdoe/)).toBeTruthy();
  });

  it("omits author when null — no 'null' text (EDGE-003)", () => {
    const item = { ...baseItem, author: null };
    render(<ArchiveStoryCard item={item} rank={1} />);
    expect(screen.queryByText("null")).toBeNull();
  });

  it("renders engagement points (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText(/▲ 342/)).toBeTruthy();
  });

  it("renders engagement comment count (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText(/💬 45/)).toBeTruthy();
  });

  it("renders engagement as '0' when both are zero (EDGE-005)", () => {
    const item = { ...baseItem, engagement: { points: 0, commentCount: 0 } };
    render(<ArchiveStoryCard item={item} rank={1} />);
    expect(screen.getByText(/▲ 0/)).toBeTruthy();
    expect(screen.getByText(/💬 0/)).toBeTruthy();
  });

  it("renders title as a link to item URL (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    const link = screen.getByRole("link", { name: "Advances in LLM Reasoning" });
    expect(link.getAttribute("href")).toBe("https://example.com/article");
  });

  it("renders 'Read more →' link to item URL (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    const link = screen.getByRole("link", { name: "Read more →" });
    expect(link.getAttribute("href")).toBe("https://example.com/article");
  });

  it("does not crash when content is null (EDGE-006)", () => {
    const item = { ...baseItem, content: null };
    expect(() => render(<ArchiveStoryCard item={item} rank={1} />)).not.toThrow();
  });

  // Image tests (REQ-015, REQ-016)

  it("renders image when imageUrl is present (REQ-015)", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/image.jpg");
  });

  it("does not render image when imageUrl is null (REQ-016)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("hides image when onError fires (EDGE-006)", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
  });

  // Recap section tests (REQ-017, REQ-018, REQ-019, REQ-020)

  it("shows recap.summary in 'The Recap:' section when recap exists (REQ-017)", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    expect(screen.getByText("The Recap:")).toBeTruthy();
    expect(screen.getByText("Test summary of the article")).toBeTruthy();
  });

  it("shows 'Unpacked:' heading and bullet list when recap exists (REQ-018)", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    expect(screen.getByText("Unpacked:")).toBeTruthy();
    expect(screen.getByText("Point 1")).toBeTruthy();
    expect(screen.getByText("Point 2")).toBeTruthy();
    expect(screen.getByText("Point 3")).toBeTruthy();
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(3);
  });

  it("shows 'Bottom line:' when recap exists (REQ-020)", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} />);
    expect(screen.getByText("Bottom line:")).toBeTruthy();
    expect(screen.getByText("Test bottom line takeaway")).toBeTruthy();
  });

  it("falls back to rationale when recap is null (REQ-019)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText("The Recap:")).toBeTruthy();
    expect(
      screen.getByText("This article covers key reasoning improvements in large language models."),
    ).toBeTruthy();
    expect(screen.queryByText("Unpacked:")).toBeNull();
    expect(screen.queryByText("Bottom line:")).toBeNull();
  });
});
