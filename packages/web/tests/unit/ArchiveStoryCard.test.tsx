import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ArchiveStoryCard } from "../../src/components/ArchiveStoryCard";
import type { RankedItem } from "@newsletter/shared/types";

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
  enrichedSource: null,
  sourceIdentifier: "news.ycombinator.com",
  preview: { kind: "none" },
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

  // Mock-A layout removed the numbered rail, LEAD STORY tag, inline engagement
  // metrics, and the "READ THE ORIGINAL" button (replaced by the source-line
  // link). Verify none of those elements render.
  it("Mock-A: omits the numbered rail, LEAD STORY tag, engagement metrics, and READ THE ORIGINAL button", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.queryByText("N°")).toBeNull();
    expect(screen.queryByText(/LEAD STORY/)).toBeNull();
    expect(container.textContent).not.toContain("▲");
    expect(container.textContent).not.toContain("COMMENTS");
    expect(screen.queryByText(/READ THE ORIGINAL/i)).toBeNull();
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

  // VS-6: enriched source — chip shows hostname, link targets enriched URL, verb is "Read on <hostname>"
  it("VS-6: enrichedSource non-null: chip shows hostname, link href is enriched URL, verb is 'Read on <hostname>'", () => {
    const enrichedItem: RankedItem = {
      ...baseItem,
      sourceType: "twitter",
      url: "https://twitter.com/user/status/123",
      enrichedSource: { hostname: "theverge.com", url: "https://theverge.com/x" },
    };
    render(<ArchiveStoryCard item={enrichedItem} rank={1} />);
    expect(screen.getByText("theverge.com")).toBeTruthy();
    const sourceLink = screen.getByRole("link", { name: /Read on theverge\.com/i });
    expect(sourceLink.getAttribute("href")).toBe("https://theverge.com/x");
  });

  // VS-7: native — chip shows platform label, link href is item.url, verb is "Read source"
  it("VS-7: enrichedSource null + sourceType hn: chip shows 'Hacker News', link href is item.url, verb is 'Read source'", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} />);
    expect(screen.getByText("Hacker News")).toBeTruthy();
    const sourceLink = screen.getByRole("link", { name: /Read source/i });
    expect(sourceLink.getAttribute("href")).toBe("https://example.com/article");
  });

  // VS-7b: github native — verb is "Read repo"
  it("VS-7b: enrichedSource null + sourceType github: verb is 'Read repo'", () => {
    const githubItem: RankedItem = {
      ...baseItem,
      sourceType: "github",
      enrichedSource: null,
    };
    render(<ArchiveStoryCard item={githubItem} rank={1} />);
    expect(screen.getByRole("link", { name: /Read repo/i })).toBeTruthy();
  });
});
