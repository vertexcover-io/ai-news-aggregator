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
    summary: "Test summary of the article",
    bullets: ["Point 1", "Point 2", "Point 3"],
    bottomLine: "Test bottom line takeaway",
  },
};

describe("ArchiveStoryCard", () => {
  afterEach(() => {
    cleanup();
  });

  // Test 1: REQ-006 — renders inside an <article>
  it("renders inside an article element (role=article)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    const articles = screen.getAllByRole("article");
    expect(articles.length).toBeGreaterThanOrEqual(1);
  });

  // Test 2: REQ-008 — left rail shows N° eyebrow + zero-padded rank
  it("left rail shows N° eyebrow and serif display number for rank 1 (renders 01)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(screen.getByText("N°")).toBeTruthy();
    expect(screen.getByText("01")).toBeTruthy();
  });

  it("left rail shows 12 for rank 12 (EDGE-009)", () => {
    render(<ArchiveStoryCard item={baseItem} rank={12} totalCount={20} />);
    expect(screen.getByText("12")).toBeTruthy();
  });

  // Test 3: REQ-009 — LEAD STORY tag for rank 1, absent for rank 2+
  it("renders LEAD STORY tag when rank === 1", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(screen.getByText("LEAD STORY")).toBeTruthy();
  });

  it("does not render LEAD STORY tag when rank === 2", () => {
    render(<ArchiveStoryCard item={baseItem} rank={2} totalCount={8} />);
    expect(screen.queryByText("LEAD STORY")).toBeNull();
  });

  // Test 4: REQ-010 — mono eyebrow contains HN · APR 18, 2026
  it("mono eyebrow contains source and formatted date uppercase (e.g. HN · APR 18, 2026)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(container.textContent).toContain("HN");
    expect(container.textContent).toContain("APR 18, 2026");
  });

  // Test 5: REQ-010 — eyebrow contains ▲ 342 when points === 342
  it("eyebrow contains ▲ 342 when points === 342", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(container.textContent).toContain("▲ 342");
  });

  // Test 6: REQ-010 — eyebrow contains 45 COMMENTS when commentCount === 45
  it("eyebrow contains 45 COMMENTS when commentCount === 45", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(container.textContent).toContain("45 COMMENTS");
  });

  // Test 7: EDGE-007 — both zero: no ▲ and no COMMENTS
  it("eyebrow has no ▲ and no COMMENTS when both are zero (EDGE-007)", () => {
    const item = { ...baseItem, engagement: { points: 0, commentCount: 0 } };
    const { container } = render(<ArchiveStoryCard item={item} rank={1} totalCount={8} />);
    expect(container.textContent).not.toContain("▲");
    expect(container.textContent).not.toContain("COMMENTS");
  });

  // Test 8: EDGE-008 — points only, no COMMENTS
  it("eyebrow includes ▲ POINTS but no COMMENTS when commentCount === 0 (EDGE-008)", () => {
    const item = { ...baseItem, engagement: { points: 100, commentCount: 0 } };
    const { container } = render(<ArchiveStoryCard item={item} rank={1} totalCount={8} />);
    expect(container.textContent).toContain("▲ 100");
    expect(container.textContent).not.toContain("COMMENTS");
  });

  // Test 9: REQ-011 — headline anchor href, target, rel
  it("headline anchor has href=item.url, target=_blank, rel=noopener noreferrer", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    const link = screen.getByRole("link", { name: "Advances in LLM Reasoning" });
    expect(link.getAttribute("href")).toBe("https://example.com/article");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  // Test 10: REQ-012 — image plate renders when imageUrl set
  it("image plate renders when imageUrl is set", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} totalCount={8} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/image.jpg");
  });

  // Test 11: EDGE-002 — image plate absent when imageUrl === null
  it("image plate absent when imageUrl === null (EDGE-002)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(container.querySelector("img")).toBeNull();
  });

  // Test 12: EDGE-003 — image unmounts after onError fires
  it("image unmounts after onError fires (EDGE-003)", () => {
    const { container } = render(<ArchiveStoryCard item={itemWithRecap} rank={1} totalCount={8} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
  });

  // Test 13: REQ-014 — italic lede renders when recap.summary set
  it("italic lede renders when recap.summary set (assert italic class present)", () => {
    const { container } = render(
      <ArchiveStoryCard item={itemWithRecap} rank={1} totalCount={8} />,
    );
    const italicEl = container.querySelector(".italic");
    expect(italicEl).not.toBeNull();
    expect(italicEl?.textContent).toContain("Test summary of the article");
  });

  // Test 14: EDGE-006 — with recap === null, renders rationale non-italic; no UNPACKED, no BOTTOM LINE
  it("with recap === null, renders rationale in non-italic serif; no UNPACKED, no BOTTOM LINE (EDGE-006)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    expect(container.textContent).toContain(
      "This article covers key reasoning improvements in large language models.",
    );
    expect(screen.queryByText("UNPACKED")).toBeNull();
    expect(screen.queryByText("BOTTOM LINE")).toBeNull();
  });

  // Test 15: REQ-016 — UNPACKED section + em-dash list renders when bullets.length >= 1
  it("UNPACKED section and em-dash bullet list renders when bullets.length >= 1", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} totalCount={8} />);
    expect(screen.getByText("UNPACKED")).toBeTruthy();
    expect(screen.getByText("Point 1")).toBeTruthy();
    expect(screen.getByText("Point 2")).toBeTruthy();
    expect(screen.getByText("Point 3")).toBeTruthy();
  });

  // Test 16: EDGE-004 — with empty bullets array, UNPACKED not present
  it("with empty bullets array, UNPACKED is not present (EDGE-004)", () => {
    const item: RankedItem = {
      ...itemWithRecap,
      recap: { summary: "Some summary", bullets: [], bottomLine: "bottom line" },
    };
    render(<ArchiveStoryCard item={item} rank={1} totalCount={8} />);
    expect(screen.queryByText("UNPACKED")).toBeNull();
  });

  // Test 17: REQ-017 — BOTTOM LINE present when bottomLine non-empty string
  it("BOTTOM LINE present when bottomLine is a non-empty string", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} totalCount={8} />);
    expect(screen.getByText("BOTTOM LINE")).toBeTruthy();
    expect(screen.getByText("Test bottom line takeaway")).toBeTruthy();
  });

  // Test 18: EDGE-005 — with bottomLine === "" (empty string), BOTTOM LINE block absent
  it("with bottomLine empty string, BOTTOM LINE block absent (EDGE-005)", () => {
    const item: RankedItem = {
      ...itemWithRecap,
      recap: { summary: "Some summary", bullets: ["A bullet"], bottomLine: "" },
    };
    render(<ArchiveStoryCard item={item} rank={1} totalCount={8} />);
    expect(screen.queryByText("BOTTOM LINE")).toBeNull();
  });

  // Test 19: REQ-018 — READ THE ORIGINAL link present with correct attrs
  it("READ THE ORIGINAL link present; href matches item.url; target=_blank; rel=noopener noreferrer", () => {
    render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    const link = screen.getByText("READ THE ORIGINAL", { exact: false }).closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com/article");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  // Test 20: REQ-019 — no colored pill backgrounds
  it("rendered markup contains none of the old colored pill bg classes (REQ-019)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    const html = container.innerHTML;
    const forbiddenClasses = [
      "bg-orange-100",
      "bg-blue-100",
      "bg-emerald-100",
      "bg-sky-100",
      "bg-violet-100",
      "bg-amber-100",
      "bg-gray-100",
    ];
    for (const cls of forbiddenClasses) {
      expect(html).not.toContain(cls);
    }
  });

  // Test 21: REQ-019 spirit — no text-blue-6xx / text-blue-7xx / text-blue-8xx
  it("rendered markup contains no text-blue-600 / text-blue-700 / text-blue-800 classes (REQ-019 spirit)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    const html = container.innerHTML;
    expect(html).not.toContain("text-blue-600");
    expect(html).not.toContain("text-blue-700");
    expect(html).not.toContain("text-blue-800");
  });

  // Test 22: REQ-007 right rail — shows 01 / 08 when rank=1, totalCount=8
  it("right rail shows 01 / 08 when rank=1 and totalCount=8", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={1} totalCount={8} />);
    // Look in the right rail specifically
    const rightRail = container.querySelector('[data-rail="right"]');
    expect(rightRail).not.toBeNull();
    expect(rightRail?.textContent).toContain("01");
    expect(rightRail?.textContent).toContain("08");
  });

  // Test 23: EDGE-009 — right rail shows 12 / 20 when rank=12, totalCount=20
  it("right rail shows 12 / 20 when rank=12 and totalCount=20 (EDGE-009)", () => {
    const { container } = render(<ArchiveStoryCard item={baseItem} rank={12} totalCount={20} />);
    const rightRail = container.querySelector('[data-rail="right"]');
    expect(rightRail).not.toBeNull();
    expect(rightRail?.textContent).toContain("12");
    expect(rightRail?.textContent).toContain("20");
  });

  // Test 24: REQ-002/REQ-003 — single-DOM responsive collapse: always-grid with rank rail
  // reflowing inline above the headline on mobile (flex-row) and as a column on desktop (md:flex-col)
  it("collapses to single-column layout on mobile with rank rail visible inline", () => {
    render(<ArchiveStoryCard item={itemWithRecap} rank={1} totalCount={8} />);
    const article = screen.getByRole("article");
    // Always-grid: one column on mobile, three on md+
    expect(article.className).toContain("grid");
    expect(article.className).toContain("grid-cols-1");
    expect(article.className).toContain("md:grid-cols-[120px_minmax(0,1fr)_120px]");

    // Left rail is visible on both mobile and desktop (single DOM tree, reflows via flex-direction)
    const leftRail = article.querySelector('[data-rail="left"]');
    expect(leftRail).not.toBeNull();
    expect(leftRail?.className).not.toContain("hidden");
    expect(leftRail?.className).toContain("flex-row");
    expect(leftRail?.className).toContain("md:flex-col");
    expect(leftRail?.textContent).toContain("N°");
    expect(leftRail?.textContent).toContain("01");
  });
});
