import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

describe("ArchiveStoryCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders rank number (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    // getByText throws if not found — proves element exists
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders source type badge (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText("hn")).toBeTruthy();
  });

  it("renders formatted publication date when publishedAt is set (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    // Should render a date string from April 13, 2026
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

  it("renders rationale prefixed with 'The Recap: ' (REQ-010)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText("The Recap:")).toBeTruthy();
    expect(screen.getByText(/This article covers key reasoning improvements/)).toBeTruthy();
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
});
